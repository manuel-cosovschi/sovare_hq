/**
 * Sync orchestration: status bookkeeping, sync_runs history, retries (inside connectors),
 * error capture without leaking secrets, and offline-friendly "stale data" signalling.
 */
import { connector, CONNECTORS } from "./registry";
import type { ConnectorDef, SyncContext, TestOutcome } from "./types";
import type { IntegrationStatus } from "@/domain/types";
import { finishRun, getIntegrationRow, listIntegrationRows, mappingLookup, patchIntegration, startRun, ensureIntegration } from "@/repos/integrations";
import { secretStatus, type SecretKey } from "@/platform/secrets";
import { logActivity } from "@/repos/core";
import { nowIso } from "@/lib/util";

export interface ConnectorState {
  def: ConnectorDef;
  status: IntegrationStatus;
  enabled: boolean;
  hasCredential: boolean | null;
  config: Record<string, string>;
  accountLabel: string | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  retryCount: number;
}

const sanitize = (msg: string) => msg.replace(/(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, "$1_$2_***").replace(/(gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, "$1***").replace(/APP_USR-[\w-]+/g, "APP_USR-***").replace(/Bearer\s+\S+/gi, "Bearer ***").slice(0, 500);

export async function connectorStates(): Promise<ConnectorState[]> {
  const rows = await listIntegrationRows();
  const keys = CONNECTORS.map((c) => c.secretKey).filter((k): k is SecretKey => !!k);
  let secrets: Record<string, boolean> = {};
  try {
    secrets = await secretStatus(keys);
  } catch {
    secrets = {};
  }
  return Promise.all(
    CONNECTORS.map(async (def) => {
      const row = rows.find((r) => r.id === def.id);
      const hasCredential = def.secretKey ? secrets[def.secretKey] ?? false : null;
      let status: IntegrationStatus;
      if (def.availability === "planned" || (def.availability === "limited" && !def.sync)) status = "unsupported";
      else if (row?.status === "syncing" || row?.status === "error") status = row.status;
      else if (def.secretKey) status = hasCredential ? (row?.last_success_at || row?.status === "connected" ? "connected" : "needs_setup") : row?.last_success_at ? "disconnected" : "needs_setup";
      else status = (await def.isConfigured?.().catch(() => false)) ? "connected" : "needs_setup";
      return {
        def,
        status,
        enabled: row?.enabled ?? false,
        hasCredential,
        config: row?.config ?? {},
        accountLabel: row?.account_label ?? null,
        lastSyncAt: row?.last_sync_at ?? null,
        lastSuccessAt: row?.last_success_at ?? null,
        lastError: row?.last_error ?? null,
        retryCount: row?.retry_count ?? 0,
      };
    }),
  );
}

async function context(id: string): Promise<SyncContext> {
  await ensureIntegration(id);
  const row = await getIntegrationRow(id);
  return { config: row?.config ?? {}, cursor: row?.sync_cursor ?? null, projectFor: await mappingLookup(id), log: () => undefined };
}

export async function testConnection(id: string): Promise<TestOutcome> {
  const def = connector(id);
  if (!def?.test) return { ok: false, message: "Esta integración no tiene prueba de conexión" };
  try {
    const r = await def.test(await context(id));
    await patchIntegration(id, { status: r.ok ? "connected" : "error", last_error: r.ok ? null : r.message, account_label: r.accountLabel ?? undefined });
    return r;
  } catch (e) {
    const msg = sanitize((e as Error).message);
    await patchIntegration(id, { status: "error", last_error: msg });
    return { ok: false, message: msg };
  }
}

const running = new Set<string>();

export async function syncConnector(id: string): Promise<{ ok: boolean; message: string }> {
  const def = connector(id);
  if (!def?.sync) return { ok: false, message: "Esta integración no sincroniza datos" };
  if (running.has(id)) return { ok: false, message: "Ya hay una sincronización en curso" };
  running.add(id);
  const run = await startRun(id);
  await patchIntegration(id, { status: "syncing", last_sync_at: nowIso() });
  try {
    const ctx = await context(id);
    const out = await def.sync(ctx);
    const partial = (out.warnings?.length ?? 0) > 0;
    await finishRun(run, { status: partial ? "partial" : "success", fetched: out.fetched, upserted: out.upserted, details: [out.details, ...(out.warnings ?? [])].filter(Boolean).join("\n") });
    await patchIntegration(id, {
      status: "connected",
      enabled: true,
      last_success_at: nowIso(),
      last_error: partial ? sanitize(out.warnings!.join("; ")) : null,
      retry_count: 0,
      sync_cursor: out.cursor === undefined ? undefined : out.cursor,
      account_label: out.accountLabel ?? undefined,
    });
    return { ok: true, message: out.details ?? `${out.upserted} registros actualizados` };
  } catch (e) {
    const msg = sanitize((e as Error).message);
    const row = await getIntegrationRow(id);
    await finishRun(run, { status: "error", fetched: 0, upserted: 0, error: msg });
    await patchIntegration(id, { status: "error", last_error: msg, retry_count: (row?.retry_count ?? 0) + 1 });
    await logActivity({ source: id, type: "integration_error", title: `Error al sincronizar ${def.name}`, detail: msg, external_id: `sync_error:${run}` });
    return { ok: false, message: msg };
  } finally {
    running.delete(id);
  }
}

/** Auto-sync while the app is open: enabled connectors whose interval elapsed. */
export async function syncDue(): Promise<string[]> {
  const states = await connectorStates();
  const ran: string[] = [];
  for (const s of states) {
    if (!s.enabled || !s.def.sync || !s.def.syncEveryMinutes || s.status === "unsupported" || s.status === "needs_setup") continue;
    // exponential backoff after consecutive errors (max 12h)
    const backoff = s.retryCount ? Math.min(720, s.def.syncEveryMinutes * 2 ** s.retryCount) : s.def.syncEveryMinutes;
    const last = s.lastSyncAt ? Date.parse(s.lastSyncAt) : 0;
    if (Date.now() - last < backoff * 60_000) continue;
    await syncConnector(s.def.id);
    ran.push(s.def.id);
  }
  return ran;
}

export async function saveConfig(id: string, config: Record<string, string>) {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) if (typeof v === "string" && v.length < 500) clean[k] = v.trim();
  await patchIntegration(id, { config: clean });
}

export async function setEnabled(id: string, enabled: boolean) {
  await patchIntegration(id, { enabled });
}

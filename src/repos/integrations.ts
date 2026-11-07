import { db } from "@/db";
import type { IntegrationRow, IntegrationStatus, SyncRun } from "@/domain/types";
import { nowIso, uid } from "@/lib/util";
import { insert, mapRow, updateById } from "./core";

export async function listIntegrationRows(): Promise<IntegrationRow[]> {
  const rows = await db().select("SELECT * FROM integrations");
  return rows.map((r) => mapRow<IntegrationRow>(r, { json: ["config"], bool: ["enabled"] }));
}

export async function getIntegrationRow(id: string): Promise<IntegrationRow | null> {
  return (await listIntegrationRows()).find((r) => r.id === id) ?? null;
}

export async function ensureIntegration(id: string, status: IntegrationStatus = "needs_setup") {
  await insert("integrations", { id, status, enabled: 0, config: "{}", created_at: nowIso(), updated_at: nowIso() }, "OR IGNORE");
}

export async function patchIntegration(id: string, patch: Partial<Omit<IntegrationRow, "id" | "config">> & { config?: Record<string, string> }) {
  await ensureIntegration(id);
  const row: Record<string, string | number | null> = { updated_at: nowIso() };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    row[k] = k === "config" ? JSON.stringify(v) : typeof v === "boolean" ? (v ? 1 : 0) : (v as string | number | null);
  }
  await updateById("integrations", id, row);
}

// ---------- mappings: external resource -> project ----------
export interface Mapping {
  id: string;
  integration_id: string;
  external_ref: string;
  external_label: string | null;
  project_id: string | null;
}

export async function listMappings(integrationId?: string): Promise<Mapping[]> {
  return integrationId
    ? db().select<Mapping>("SELECT * FROM integration_mappings WHERE integration_id = ? ORDER BY external_label", [integrationId])
    : db().select<Mapping>("SELECT * FROM integration_mappings");
}

export async function setMapping(integrationId: string, externalRef: string, projectId: string | null, label?: string | null) {
  await ensureIntegration(integrationId);
  await db().execute(
    `INSERT INTO integration_mappings (id, integration_id, external_ref, external_label, project_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, external_ref) DO UPDATE SET project_id = excluded.project_id, external_label = COALESCE(excluded.external_label, integration_mappings.external_label)`,
    [uid(), integrationId, externalRef, label ?? null, projectId, nowIso()],
  );
}

export async function mappingLookup(integrationId: string): Promise<(ref: string) => string | null> {
  const m = await listMappings(integrationId);
  const map = new Map(m.map((x) => [x.external_ref, x.project_id]));
  return (ref) => map.get(ref) ?? null;
}

// ---------- sync runs ----------
export async function startRun(integrationId: string): Promise<string> {
  const id = uid();
  await insert("sync_runs", { id, integration_id: integrationId, started_at: nowIso(), status: "running" });
  return id;
}

export async function finishRun(id: string, r: { status: SyncRun["status"]; fetched: number; upserted: number; error?: string | null; details?: string | null }) {
  await updateById("sync_runs", id, { finished_at: nowIso(), status: r.status, items_fetched: r.fetched, items_upserted: r.upserted, error: r.error ?? null, details: r.details ?? null });
}

export async function listRuns(integrationId: string, limit = 10): Promise<SyncRun[]> {
  return db().select<SyncRun>("SELECT * FROM sync_runs WHERE integration_id = ? ORDER BY started_at DESC LIMIT ?", [integrationId, limit]);
}

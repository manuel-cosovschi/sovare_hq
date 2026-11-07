import { db } from "@/db";
import type { Deployment, DevItem, HealthCheck, HealthResult } from "@/domain/types";
import { nowIso, uid } from "@/lib/util";
import { insert, logActivity, mapRow, updateById } from "./core";
import { z } from "zod";

export interface DevItemUpsert {
  repository_id: string | null;
  project_id: string | null;
  kind: DevItem["kind"];
  external_id: string;
  number?: number | null;
  title: string;
  state?: string | null;
  author?: string | null;
  url?: string | null;
  created_at_ext: string;
  updated_at_ext?: string | null;
  closed_at_ext?: string | null;
  extra?: Record<string, unknown>;
}

export async function upsertDevItems(items: DevItemUpsert[]) {
  if (!items.length) return 0;
  const now = nowIso();
  return db().batch(
    items.map((i) => ({
      sql: `INSERT INTO dev_items (id, repository_id, project_id, kind, external_id, number, title, state, author, url, created_at_ext, updated_at_ext, closed_at_ext, extra, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(kind, external_id) DO UPDATE SET title = excluded.title, state = excluded.state, project_id = COALESCE(excluded.project_id, dev_items.project_id),
              updated_at_ext = excluded.updated_at_ext, closed_at_ext = excluded.closed_at_ext, extra = excluded.extra, synced_at = excluded.synced_at`,
      params: [uid(), i.repository_id, i.project_id, i.kind, i.external_id, i.number ?? null, i.title, i.state ?? null, i.author ?? null, i.url ?? null, i.created_at_ext, i.updated_at_ext ?? null, i.closed_at_ext ?? null, JSON.stringify(i.extra ?? {}), now],
    })),
  );
}

export async function listDevItems(opts: { projectId?: string; kind?: DevItem["kind"]; limit?: number; since?: string } = {}): Promise<DevItem[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.projectId) { where.push("project_id = ?"); params.push(opts.projectId); }
  if (opts.kind) { where.push("kind = ?"); params.push(opts.kind); }
  if (opts.since) { where.push("COALESCE(updated_at_ext, created_at_ext) >= ?"); params.push(opts.since); }
  const rows = await db().select(
    `SELECT * FROM dev_items ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY COALESCE(updated_at_ext, created_at_ext) DESC LIMIT ?`,
    [...params, opts.limit ?? 200],
  );
  return rows.map((r) => mapRow<DevItem>(r, { json: ["extra"] }));
}

export type DeploymentUpsert = Omit<Deployment, "id">;

export async function upsertDeployments(list: DeploymentUpsert[]) {
  if (!list.length) return 0;
  const now = nowIso();
  return db().batch(
    list.map((d) => ({
      sql: `INSERT INTO deployments (id, project_id, provider, external_id, provider_project, environment, status, url, inspect_url, commit_sha, commit_message, branch, created_at_ext, finished_at_ext, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider, external_id) DO UPDATE SET status = excluded.status, project_id = COALESCE(excluded.project_id, deployments.project_id), finished_at_ext = excluded.finished_at_ext, synced_at = excluded.synced_at`,
      params: [uid(), d.project_id, d.provider, d.external_id, d.provider_project, d.environment, d.status, d.url, d.inspect_url, d.commit_sha, d.commit_message, d.branch, d.created_at_ext, d.finished_at_ext, now],
    })),
  );
}

export async function listDeployments(opts: { projectId?: string; limit?: number } = {}): Promise<Deployment[]> {
  return opts.projectId
    ? db().select<Deployment>("SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at_ext DESC LIMIT ?", [opts.projectId, opts.limit ?? 50])
    : db().select<Deployment>("SELECT * FROM deployments ORDER BY created_at_ext DESC LIMIT ?", [opts.limit ?? 100]);
}

// ---------- health checks ----------
export const healthInput = z.object({
  project_id: z.string().nullish(),
  name: z.string().trim().min(1).max(120),
  url: z.string().url().refine((u) => /^https?:\/\//.test(u), "Solo http(s)"),
  method: z.enum(["GET", "HEAD"]).default("GET"),
  expected_status: z.number().int().min(100).max(599).default(200),
  timeout_ms: z.number().int().min(1000).max(60000).default(10000),
  interval_minutes: z.number().int().min(1).max(1440).default(15),
  enabled: z.boolean().default(true),
});

export async function listHealthChecks(): Promise<HealthCheck[]> {
  const rows = await db().select("SELECT * FROM health_checks ORDER BY name");
  return rows.map((r) => mapRow<HealthCheck>(r, { bool: ["enabled"] }));
}

export async function saveHealthCheck(input: z.input<typeof healthInput>, id?: string) {
  const h = healthInput.parse(input);
  const row = { ...h, project_id: h.project_id ?? null, updated_at: nowIso() };
  if (id) return void (await updateById("health_checks", id, row));
  await insert("health_checks", { id: uid(), ...row, created_at: nowIso() });
}

export async function deleteHealthCheck(id: string) {
  await db().execute("DELETE FROM health_checks WHERE id = ?", [id]);
}

export async function recordHealthResult(check: HealthCheck, r: { ok: boolean; status_code: number | null; latency_ms: number | null; error: string | null }) {
  const prev = (await listHealthResults(check.id, 1))[0];
  const at = nowIso();
  await insert("health_results", { id: uid(), check_id: check.id, checked_at: at, ok: r.ok, status_code: r.status_code, latency_ms: r.latency_ms, error: r.error });
  if (prev && prev.ok !== r.ok)
    await logActivity({
      source: "monitoring",
      type: r.ok ? "service_recovered" : "service_down",
      title: r.ok ? `${check.name} se recuperó` : `${check.name} dejó de responder (${r.status_code ?? r.error ?? "error"})`,
      project_id: check.project_id,
      external_id: `health:${check.id}:${at}`,
    });
  // retention: keep the latest 500 results per check
  await db().execute("DELETE FROM health_results WHERE check_id = ? AND id NOT IN (SELECT id FROM health_results WHERE check_id = ? ORDER BY checked_at DESC LIMIT 500)", [check.id, check.id]);
}

export async function listHealthResults(checkId: string, limit = 50): Promise<HealthResult[]> {
  const rows = await db().select("SELECT * FROM health_results WHERE check_id = ? ORDER BY checked_at DESC LIMIT ?", [checkId, limit]);
  return rows.map((r) => mapRow<HealthResult>(r, { bool: ["ok"] }));
}

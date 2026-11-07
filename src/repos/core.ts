import { db } from "@/db";
import type { Row, SqlParam } from "@/db/types";
import { nowIso, parseJson, uid } from "@/lib/util";

/** Builds an INSERT from a plain object (keys come from code, never from user input). */
export async function insert(table: string, obj: Record<string, SqlParam>, mode: "" | "OR IGNORE" | "OR REPLACE" = "") {
  const keys = Object.keys(obj);
  const sql = `INSERT ${mode} INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`;
  return db().execute(sql, keys.map((k) => obj[k]));
}

export async function updateById(table: string, id: string, patch: Record<string, SqlParam>) {
  const keys = Object.keys(patch);
  if (!keys.length) return { changes: 0, lastId: 0 };
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
  return db().execute(sql, [...keys.map((k) => patch[k]), id]);
}

export const jsonCol = (v: unknown) => JSON.stringify(v ?? null);

/** zod v4 `.partial()` still fills `.default()` values: keep only the keys the caller actually passed. */
export function onlyProvided<T extends object>(parsed: T, input: object): Partial<T> {
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => k in input)) as Partial<T>;
}

export function mapRow<T>(row: Row, opts: { json?: string[]; bool?: string[] } = {}): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of opts.json ?? []) out[k] = parseJson(row[k], k.endsWith("s") || k === "labels" || k === "depends_on" ? [] : {});
  for (const k of opts.bool ?? []) out[k] = row[k] === 1 || row[k] === "1";
  return out as T;
}

export async function audit(entity: string, entityId: string, action: "create" | "update" | "delete" | "restore", before: unknown, after: unknown) {
  await insert("audit_log", {
    id: uid(),
    entity,
    entity_id: entityId,
    action,
    before: before === null || before === undefined ? null : JSON.stringify(before),
    after: after === null || after === undefined ? null : JSON.stringify(after),
    at: nowIso(),
  });
}

export async function auditTrail(entity: string, entityId: string) {
  return db().select<{ id: string; action: string; before: string | null; after: string | null; at: string }>(
    "SELECT id, action, before, after, at FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY at DESC",
    [entity, entityId],
  );
}

// ---------- preferences ----------
export async function getPref<T>(key: string, fallback: T): Promise<T> {
  const rows = await db().select<{ value: string }>("SELECT value FROM user_preferences WHERE key = ?", [key]);
  return rows.length ? parseJson<T>(rows[0].value, fallback) : fallback;
}

export async function setPref(key: string, value: unknown) {
  await db().execute(
    "INSERT INTO user_preferences (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [key, JSON.stringify(value), nowIso()],
  );
}

// ---------- activity ----------
export interface ActivityInput {
  source: string;
  type: string;
  title: string;
  project_id?: string | null;
  occurred_at?: string;
  detail?: string | null;
  external_id?: string | null;
  url?: string | null;
}

export async function logActivity(a: ActivityInput) {
  const occurred = a.occurred_at ?? nowIso();
  const r = await insert(
    "activity_events",
    {
      id: uid(),
      occurred_at: occurred,
      project_id: a.project_id ?? null,
      source: a.source,
      type: a.type,
      title: a.title,
      detail: a.detail ?? null,
      external_id: a.external_id ?? null,
      url: a.url ?? null,
      created_at: nowIso(),
    },
    "OR IGNORE",
  );
  if (r.changes && a.project_id) await touchProject(a.project_id, occurred);
  return r.changes > 0;
}

export async function touchProject(projectId: string, at: string) {
  await db().execute(
    "UPDATE projects SET last_activity_at = ? WHERE id = ? AND (last_activity_at IS NULL OR last_activity_at < ?)",
    [at, projectId, at],
  );
}

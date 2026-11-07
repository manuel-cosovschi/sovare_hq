import { db } from "@/db";
import type { MetricObservation } from "@/domain/types";
import { nowIso, uid } from "@/lib/util";
import { mapRow } from "./core";

export interface ObservationInput {
  project_id: string | null;
  metric_key: string;
  value: number;
  unit: string;
  currency?: string | null;
  period_start: string;
  period_end: string;
  source: string;
  source_ref?: string | null;
  is_manual?: boolean;
}

export async function upsertObservations(list: ObservationInput[]) {
  if (!list.length) return 0;
  const now = nowIso();
  return db().batch(
    list.map((o) => ({
      sql: `INSERT INTO metric_observations (id, project_id, metric_key, value, unit, currency, period_start, period_end, source, source_ref, is_manual, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(COALESCE(project_id, ''), metric_key, period_start, period_end, source) DO UPDATE SET value = excluded.value, unit = excluded.unit, currency = excluded.currency, recorded_at = excluded.recorded_at`,
      params: [uid(), o.project_id, o.metric_key, o.value, o.unit, o.currency ?? null, o.period_start, o.period_end, o.source, o.source_ref ?? null, o.is_manual ? 1 : 0, now],
    })),
  );
}

export async function listObservations(opts: { projectId?: string | null; metricKey?: string } = {}): Promise<MetricObservation[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (opts.projectId) { where.push("project_id = ?"); params.push(opts.projectId); }
  if (opts.metricKey) { where.push("metric_key = ?"); params.push(opts.metricKey); }
  const rows = await db().select(`SELECT * FROM metric_observations ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY period_end`, params);
  return rows.map((r) => mapRow<MetricObservation>(r, { bool: ["is_manual"] }));
}

export async function deleteObservation(id: string) {
  await db().execute("DELETE FROM metric_observations WHERE id = ?", [id]);
}

import { db } from "@/db";
import type { AdMetricRow, Campaign } from "@/domain/types";
import { nowIso, uid } from "@/lib/util";
import { logActivity } from "./core";

export type CampaignUpsert = Omit<Campaign, "id" | "synced_at">;

/** Upserts campaigns keyed by (platform, external_id). Returns map external_id -> internal id. */
export async function upsertCampaigns(list: CampaignUpsert[]): Promise<Record<string, string>> {
  const now = nowIso();
  const existing = await db().select<{ id: string; external_id: string; platform: string; status: string; name: string; project_id: string | null }>("SELECT id, external_id, platform, status, name, project_id FROM campaigns");
  const byKey = new Map(existing.map((e) => [`${e.platform}:${e.external_id}`, e]));
  const out: Record<string, string> = {};
  for (const c of list) {
    const prev = byKey.get(`${c.platform}:${c.external_id}`);
    const id = prev?.id ?? uid();
    out[c.external_id] = id;
    await db().execute(
      `INSERT INTO campaigns (id, platform, account_id, external_id, level, parent_external_id, project_id, name, objective, status, daily_budget_minor, lifetime_budget_minor, currency, start_on, end_on, source, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(platform, external_id) DO UPDATE SET name = excluded.name, objective = excluded.objective, status = excluded.status,
         daily_budget_minor = excluded.daily_budget_minor, lifetime_budget_minor = excluded.lifetime_budget_minor, currency = excluded.currency,
         start_on = excluded.start_on, end_on = excluded.end_on, project_id = COALESCE(campaigns.project_id, excluded.project_id), synced_at = excluded.synced_at, updated_at = excluded.updated_at`,
      [id, c.platform, c.account_id, c.external_id, c.level, c.parent_external_id, c.project_id, c.name, c.objective, c.status, c.daily_budget_minor, c.lifetime_budget_minor, c.currency, c.start_on, c.end_on, c.source, now, now, now],
    );
    if (!prev)
      await logActivity({ source: c.platform, type: "campaign_started", title: `Campaña detectada: ${c.name} (${c.status})`, project_id: c.project_id, external_id: `campaign_new:${c.platform}:${c.external_id}` });
    else if (prev.status !== c.status)
      await logActivity({
        source: c.platform,
        type: /active/i.test(c.status) ? "campaign_started" : "campaign_stopped",
        title: `Campaña ${c.name}: ${prev.status} → ${c.status}`,
        project_id: prev.project_id ?? c.project_id,
        external_id: `campaign_status:${c.platform}:${c.external_id}:${c.status}:${now.slice(0, 10)}`,
      });
  }
  return out;
}

export async function upsertAdMetrics(rows: Array<Omit<AdMetricRow, "id">>) {
  if (!rows.length) return 0;
  const now = nowIso();
  return db().batch(
    rows.map((m) => ({
      sql: `INSERT INTO ad_metrics (id, campaign_id, date, impressions, reach, clicks, spend_minor, currency, conversions, conversion_value_minor, conversion_label, source, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(campaign_id, date) DO UPDATE SET impressions = excluded.impressions, reach = excluded.reach, clicks = excluded.clicks, spend_minor = excluded.spend_minor,
              currency = excluded.currency, conversions = excluded.conversions, conversion_value_minor = excluded.conversion_value_minor, conversion_label = excluded.conversion_label, synced_at = excluded.synced_at`,
      params: [uid(), m.campaign_id, m.date, m.impressions, m.reach, m.clicks, m.spend_minor, m.currency, m.conversions, m.conversion_value_minor, m.conversion_label, m.source, now],
    })),
  );
}

export async function listCampaigns(): Promise<Campaign[]> {
  return db().select<Campaign>("SELECT * FROM campaigns ORDER BY CASE WHEN lower(status) LIKE '%active%' THEN 0 ELSE 1 END, name");
}

export async function listAdMetrics(from?: string, to?: string): Promise<AdMetricRow[]> {
  return from && to
    ? db().select<AdMetricRow>("SELECT * FROM ad_metrics WHERE date >= ? AND date <= ? ORDER BY date", [from, to])
    : db().select<AdMetricRow>("SELECT * FROM ad_metrics ORDER BY date");
}

export async function setCampaignProject(campaignId: string, projectId: string | null) {
  await db().execute("UPDATE campaigns SET project_id = ?, updated_at = ? WHERE id = ?", [projectId, nowIso(), campaignId]);
}

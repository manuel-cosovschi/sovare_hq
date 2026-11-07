import { db } from "@/db";
import type { Alert } from "@/domain/types";
import { evaluateRules, RULES, type AlertSnapshot, type RuleConfig } from "@/domain/alertRules";
import { addDays, nowIso, parseJson, todayStr, uid } from "@/lib/util";
import { mapRow } from "./core";
import { listProjects } from "./projects";
import { listTransactions, listRecurring, listBudgets } from "./finance";
import { listTasks } from "./tasks";
import { listDeployments, listHealthChecks, listHealthResults } from "./dev";
import { listCampaigns, listAdMetrics } from "./marketing";
import { listIntegrationRows } from "./integrations";
import { CONNECTOR_NAMES } from "@/integrations/names";

export async function listAlerts(status: Alert["status"] | "all" = "open"): Promise<Alert[]> {
  const rows =
    status === "all"
      ? await db().select("SELECT * FROM alerts ORDER BY last_seen_at DESC LIMIT 300")
      : await db().select(
          "SELECT * FROM alerts WHERE status = ? ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_seen_at DESC",
          [status],
        );
  return rows.map((r) => mapRow<Alert>(r, { json: ["evidence"] }));
}

export async function setAlertStatus(id: string, status: Alert["status"]) {
  await db().execute("UPDATE alerts SET status = ?, resolved_at = ? WHERE id = ?", [status, status === "open" ? null : nowIso(), id]);
}

export async function ruleConfigs(): Promise<Record<string, RuleConfig & { notify: boolean }>> {
  const rows = await db().select<{ id: string; enabled: number; notify: number; params: string }>("SELECT * FROM alert_rules");
  return Object.fromEntries(rows.map((r) => [r.id, { enabled: r.enabled === 1, notify: r.notify === 1, params: parseJson(r.params, {}) }]));
}

export async function saveRuleConfig(id: string, cfg: { enabled: boolean; notify: boolean; params: Record<string, number> }) {
  await db().execute(
    `INSERT INTO alert_rules (id, enabled, notify, params, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, notify = excluded.notify, params = excluded.params, updated_at = excluded.updated_at`,
    [id, cfg.enabled ? 1 : 0, cfg.notify ? 1 : 0, JSON.stringify(cfg.params), nowIso()],
  );
}

export async function buildSnapshot(today = todayStr()): Promise<AlertSnapshot> {
  const configs = await ruleConfigs();
  const adWindow = (configs.ad_no_conversions?.params.days as number | undefined) ?? 7;
  const [projects, txs, tasks, recurring, budgets, deployments, checks, campaigns, metrics, integrations] = await Promise.all([
    listProjects(),
    listTransactions({ from: addDays(today, -120) }),
    listTasks(),
    listRecurring(),
    listBudgets(today.slice(0, 7)),
    listDeployments({ limit: 300 }),
    listHealthChecks(),
    listCampaigns(),
    listAdMetrics(`${today.slice(0, 7)}-01` < addDays(today, -adWindow + 1) ? `${today.slice(0, 7)}-01` : addDays(today, -adWindow + 1), today),
    listIntegrationRows(),
  ]);
  const windowFrom = addDays(today, -adWindow + 1);
  const health = await Promise.all(
    checks.filter((c) => c.enabled).map(async (c) => ({
      check_id: c.id,
      name: c.name,
      project_id: c.project_id,
      recent: (await listHealthResults(c.id, 5)).map((r) => ({ ok: r.ok, checked_at: r.checked_at, status_code: r.status_code, error: r.error })),
      last_ok_at: (await db().select<{ at: string | null }>("SELECT MAX(checked_at) AS at FROM health_results WHERE check_id = ? AND ok = 1", [c.id]))[0]?.at ?? null,
    })),
  );
  return {
    today,
    projects: projects.map((p) => ({ id: p.id, name: p.name, status: p.status, last_activity_at: p.last_activity_at, target_launch_on: p.target_launch_on })),
    deployments: deployments.map((d) => ({ project_id: d.project_id, provider: d.provider, provider_project: d.provider_project, status: d.status, created_at_ext: d.created_at_ext, external_id: d.external_id, inspect_url: d.inspect_url })),
    campaigns: campaigns
      .filter((c) => c.level === "campaign")
      .map((c) => {
        const rows = metrics.filter((m) => m.campaign_id === c.id);
        const win = rows.filter((m) => m.date >= windowFrom);
        const conv = win.map((m) => m.conversions).filter((v): v is number => v !== null);
        return {
          id: c.id,
          name: c.name,
          project_id: c.project_id,
          status: c.status,
          currency: c.currency,
          spendWindow: win.reduce((s, m) => s + (m.spend_minor ?? 0), 0),
          conversionsWindow: conv.length ? conv.reduce((a, b) => a + b, 0) : null,
          spendMonth: rows.filter((m) => m.date.startsWith(today.slice(0, 7))).reduce((s, m) => s + (m.spend_minor ?? 0), 0),
        };
      }),
    txs,
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_on: t.due_on, project_id: t.project_id })),
    recurring: recurring.map((r) => ({ id: r.id, name: r.name, next_due_on: r.next_due_on, amount_minor: r.amount_minor, currency: r.currency, active: r.active, project_id: r.project_id })),
    integrations: integrations.map((i) => ({ id: i.id, name: CONNECTOR_NAMES[i.id] ?? i.id, enabled: i.enabled, status: i.status, last_success_at: i.last_success_at, last_error: i.last_error })),
    health,
    budgets,
  };
}

/**
 * Evaluates all rules and reconciles the alerts table:
 *  - new fingerprint → open alert; seen again → last_seen_at updated
 *  - open alert whose condition disappeared → resolved
 *  - dismissed alerts stay dismissed while the condition persists
 * Returns newly opened alerts (for notifications).
 */
export async function evaluateAlerts(today = todayStr()): Promise<Alert[]> {
  const snapshot = await buildSnapshot(today);
  const configs = await ruleConfigs();
  const candidates = evaluateRules(snapshot, configs);
  const now = nowIso();
  const existing = await db().select<{ id: string; fingerprint: string; status: string }>("SELECT id, fingerprint, status FROM alerts WHERE status != 'resolved' OR resolved_at > ?", [addDays(today, -30)]);
  const byFp = new Map(existing.map((e) => [e.fingerprint, e]));
  const fresh: string[] = [];
  for (const c of candidates) {
    const e = byFp.get(c.fingerprint);
    if (e) {
      await db().execute("UPDATE alerts SET last_seen_at = ?, title = ?, detail = ?, evidence = ?, status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END, resolved_at = CASE WHEN status = 'resolved' THEN NULL ELSE resolved_at END WHERE id = ?", [now, c.title, c.detail, JSON.stringify(c.evidence), e.id]);
    } else {
      const id = uid();
      const r = await db().execute(
        `INSERT OR IGNORE INTO alerts (id, rule_id, fingerprint, project_id, severity, title, detail, evidence, link, status, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        [id, c.rule_id, c.fingerprint, c.project_id, c.severity, c.title, c.detail, JSON.stringify(c.evidence), c.link, now, now],
      );
      if (r.changes) fresh.push(id);
      else {
        // same fingerprint resolved before the reconciliation window: the condition is back → re-open it
        const old = await db().select<{ id: string }>("SELECT id FROM alerts WHERE fingerprint = ? AND status = 'resolved'", [c.fingerprint]);
        if (old[0]) {
          await db().execute(
            "UPDATE alerts SET status = 'open', resolved_at = NULL, notified_at = NULL, severity = ?, title = ?, detail = ?, evidence = ?, first_seen_at = ?, last_seen_at = ? WHERE id = ?",
            [c.severity, c.title, c.detail, JSON.stringify(c.evidence), now, now, old[0].id],
          );
          fresh.push(old[0].id);
        }
      }
    }
  }
  const active = new Set(candidates.map((c) => c.fingerprint));
  for (const e of existing) if (e.status === "open" && !active.has(e.fingerprint)) await db().execute("UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE id = ?", [now, e.id]);
  if (!fresh.length) return [];
  const rows = await db().select(`SELECT * FROM alerts WHERE id IN (${fresh.map(() => "?").join(",")})`, fresh);
  return rows.map((r) => mapRow<Alert>(r, { json: ["evidence"] }));
}

export async function markNotified(ids: string[]) {
  for (const id of ids) await db().execute("UPDATE alerts SET notified_at = ? WHERE id = ?", [nowIso(), id]);
}

export { RULES };

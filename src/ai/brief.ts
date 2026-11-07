/** "Esto cambió desde tu última visita" — built only from recorded events and data. */
import { db } from "@/db";
import type { ActivityEvent, Alert } from "@/domain/types";
import { mapRow } from "@/repos/core";
import { summarize } from "@/domain/finance";
import { listTransactions } from "@/repos/finance";
import { formatMoney } from "@/domain/money";

export interface DailyBrief {
  since: string | null;
  events: ActivityEvent[];
  countsByType: Record<string, number>;
  newAlerts: Alert[];
  resolvedAlerts: number;
  money: Array<{ currency: string; income: number; expenses: number }>;
  tasksCompleted: number;
  lines: string[];
  empty: boolean;
}

export async function buildDailyBrief(since: string | null): Promise<DailyBrief> {
  const from = since ?? new Date(Date.now() - 86400_000).toISOString();
  const events = await db().select<ActivityEvent>("SELECT * FROM activity_events WHERE created_at > ? ORDER BY occurred_at DESC LIMIT 200", [from]);
  const newAlerts = (await db().select("SELECT * FROM alerts WHERE first_seen_at > ? AND status = 'open' ORDER BY severity", [from])).map((r) => mapRow<Alert>(r, { json: ["evidence"] }));
  const resolved = await db().select<{ n: number }>("SELECT count(*) AS n FROM alerts WHERE resolved_at > ? AND status = 'resolved'", [from]);
  const newTx = (await listTransactions()).filter((t) => t.created_at > from);
  const s = summarize(newTx);
  const money = Object.entries(s).map(([currency, b]) => ({ currency, income: b.netRevenue, expenses: b.operatingExpenses + b.fees + b.investment }));
  const countsByType: Record<string, number> = {};
  for (const e of events) countsByType[e.type] = (countsByType[e.type] ?? 0) + 1;
  const tasksCompleted = countsByType["task_completed"] ?? 0;

  const lines: string[] = [];
  for (const m of money) {
    if (m.income) lines.push(`Se registraron ${formatMoney(m.income, m.currency)} de ingresos netos nuevos.`);
    if (m.expenses) lines.push(`Se registraron ${formatMoney(m.expenses, m.currency)} de gastos nuevos.`);
  }
  if (countsByType.commit) lines.push(`${countsByType.commit} commit(s) nuevos sincronizados.`);
  if (countsByType.pr_merged) lines.push(`${countsByType.pr_merged} pull request(s) fusionados.`);
  if (countsByType.deploy_failed) lines.push(`${countsByType.deploy_failed} deploy(s) fallidos.`);
  if (countsByType.deploy) lines.push(`${countsByType.deploy} deploy(s) a producción.`);
  if (countsByType.workflow_failed) lines.push(`${countsByType.workflow_failed} workflow(s) de CI fallidos.`);
  if (countsByType.service_down) lines.push(`${countsByType.service_down} servicio(s) dejaron de responder.`);
  if (tasksCompleted) lines.push(`${tasksCompleted} tarea(s) completadas.`);
  if (newAlerts.length) lines.push(`${newAlerts.length} alerta(s) nuevas.`);
  if (resolved[0]?.n) lines.push(`${resolved[0].n} alerta(s) se resolvieron.`);
  const campaignChanges = (countsByType.campaign_started ?? 0) + (countsByType.campaign_stopped ?? 0);
  if (campaignChanges) lines.push(`${campaignChanges} cambio(s) de estado en campañas.`);

  return { since, events: events.slice(0, 12), countsByType, newAlerts, resolvedAlerts: resolved[0]?.n ?? 0, money, tasksCompleted, lines, empty: events.length === 0 && newAlerts.length === 0 && !resolved[0]?.n };
}

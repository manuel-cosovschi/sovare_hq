/**
 * In-app scheduler. Runs ONLY while Sovare HQ is open (window visible, minimized or in the menu
 * bar). There is no background daemon: the UI says so explicitly.
 */
import { runDueHealthChecks } from "@/integrations/connectors/local";
import { syncDue } from "@/integrations/runner";
import { evaluateAlerts, markNotified, ruleConfigs } from "@/repos/alerts";
import { getPref } from "@/repos/core";
import { notify, updateTray } from "@/platform/notify";
import { listAlerts } from "@/repos/alerts";
import { listTasks } from "@/repos/tasks";
import { listTransactions } from "@/repos/finance";
import { summarize } from "@/domain/finance";
import { formatMoney } from "@/domain/money";
import { todayStr } from "@/lib/util";
import { activeProfile } from "@/db";

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lastAlertsEval = 0;

export interface SchedulerPrefs {
  autoSync: boolean;
  notifications: boolean;
  alertsEveryMinutes: number;
}
export const DEFAULT_SCHED: SchedulerPrefs = { autoSync: true, notifications: true, alertsEveryMinutes: 5 };

export async function tick(onChange: () => void) {
  if (ticking) return;
  ticking = true;
  try {
    const prefs = { ...DEFAULT_SCHED, ...(await getPref<Partial<SchedulerPrefs>>("scheduler", {})) };
    const health = await runDueHealthChecks();
    const synced = prefs.autoSync && activeProfile() === "main" ? await syncDue() : [];
    if (health.ran || synced.length || Date.now() - lastAlertsEval > prefs.alertsEveryMinutes * 60_000) {
      lastAlertsEval = Date.now();
      const fresh = await evaluateAlerts();
      const cfg = await ruleConfigs();
      const toNotify = fresh.filter((a) => a.severity !== "info" && cfg[a.rule_id]?.notify !== false);
      if (prefs.notifications && toNotify.length && activeProfile() === "main") {
        for (const a of toNotify.slice(0, 3)) await notify(a.title, a.detail ?? "");
        await markNotified(toNotify.map((a) => a.id));
      }
      await refreshTray();
      onChange();
    }
  } catch (e) {
    console.warn("scheduler tick failed", e);
  } finally {
    ticking = false;
  }
}

export async function refreshTray() {
  const today = todayStr();
  const [alerts, tasks, txs] = await Promise.all([listAlerts("open"), listTasks(), listTransactions({ from: `${today.slice(0, 7)}-01` })]);
  const month = summarize(txs);
  const lines: string[] = [];
  if (activeProfile() === "demo") lines.push("MODO DEMO");
  for (const [c, b] of Object.entries(month)) lines.push(`Mes ${c}: ingresos ${formatMoney(b.netRevenue, c, { compact: true })} · beneficio ${formatMoney(b.operatingProfit, c, { compact: true })}`);
  if (!Object.keys(month).length) lines.push("Mes: sin transacciones registradas");
  const critical = alerts.filter((a) => a.severity === "critical").length;
  lines.push(`${alerts.length} alertas abiertas${critical ? ` (${critical} críticas)` : ""}`);
  lines.push(`${tasks.filter((t) => t.due_on === today && t.status !== "done").length} tareas para hoy · ${tasks.filter((t) => t.due_on && t.due_on < today && !["done", "canceled"].includes(t.status)).length} vencidas`);
  await updateTray(lines);
}

export function startScheduler(onChange: () => void) {
  stopScheduler();
  void tick(onChange);
  timer = setInterval(() => void tick(onChange), 60_000);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Weekly Business Review: deterministic report over recorded data (optionally narrated by AI). */
import { listProjects } from "@/repos/projects";
import { listTransactions } from "@/repos/finance";
import { listCampaigns, listAdMetrics } from "@/repos/marketing";
import { listDevItems, listDeployments } from "@/repos/dev";
import { listTasks } from "@/repos/tasks";
import { listAlerts } from "@/repos/alerts";
import { summarize, byProject } from "@/domain/finance";
import { aggregate } from "@/domain/ads";
import { addDays, todayStr } from "@/lib/util";
import { generateInsights } from "./localEngine";
import { smartTasks } from "./tools";
import { formatMoney } from "@/domain/money";
import { activeProfile } from "@/db";

export interface WeeklyReview {
  generatedAt: string;
  demo: boolean;
  period: { from: string; to: string };
  previous: { from: string; to: string };
  finance: Array<{ currency: string; netRevenue: number; prevNetRevenue: number; expenses: number; prevExpenses: number; profit: number; prevProfit: number; investment: number }>;
  topProjects: Array<{ name: string; currency: string; netRevenue: number; profit: number }>;
  campaigns: Array<{ name: string; currency: string | null; spend: number | null; conversions: number | null; ctr: number | null }>;
  tasksDone: Array<{ title: string; project: string | null }>;
  development: { commits: number; prsMerged: number; releases: number; deploysOk: number; deploysFailed: number; workflowsFailed: number };
  improvements: string[];
  problems: string[];
  priorities: Array<{ title: string; reason: string }>;
  narrative?: string;
}

export async function buildWeeklyReview(today = todayStr()): Promise<WeeklyReview> {
  const period = { from: addDays(today, -6), to: today };
  const previous = { from: addDays(today, -13), to: addDays(today, -7) };
  const [projects, txs, camps, ads, items, deploys, tasks, alerts, insights, top] = await Promise.all([
    listProjects(),
    listTransactions({ from: previous.from }),
    listCampaigns(),
    listAdMetrics(period.from, period.to),
    listDevItems({ since: period.from, limit: 2000 }),
    listDeployments({ limit: 300 }),
    listTasks(),
    listAlerts("all"),
    generateInsights(today),
    smartTasks(5),
  ]);
  const pname = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "Sin proyecto";
  const cur = summarize(txs, period);
  const prev = summarize(txs, previous);
  const finance = [...new Set([...Object.keys(cur), ...Object.keys(prev)])].map((c) => ({
    currency: c,
    netRevenue: cur[c]?.netRevenue ?? 0,
    prevNetRevenue: prev[c]?.netRevenue ?? 0,
    expenses: (cur[c]?.operatingExpenses ?? 0) + (cur[c]?.fees ?? 0),
    prevExpenses: (prev[c]?.operatingExpenses ?? 0) + (prev[c]?.fees ?? 0),
    profit: cur[c]?.operatingProfit ?? 0,
    prevProfit: prev[c]?.operatingProfit ?? 0,
    investment: cur[c]?.investment ?? 0,
  }));
  const topProjects = byProject(txs, period)
    .flatMap((p) => Object.entries(p.summary).map(([currency, b]) => ({ name: pname(p.projectId), currency, netRevenue: b.netRevenue, profit: b.operatingProfit })))
    .filter((x) => x.netRevenue > 0)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5);
  const campaigns = camps
    .map((c) => {
      const a = aggregate(ads.filter((m) => m.campaign_id === c.id));
      return { name: c.name, currency: c.currency, spend: a.spend, conversions: a.conversions, ctr: a.ctr };
    })
    .filter((c) => (c.spend ?? 0) > 0)
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
    .slice(0, 6);
  const tasksDone = tasks.filter((t) => t.status === "done" && t.completed_at && t.completed_at.slice(0, 10) >= period.from).map((t) => ({ title: t.title, project: t.project_id ? pname(t.project_id) : null }));
  const wk = deploys.filter((d) => d.created_at_ext.slice(0, 10) >= period.from);
  const development = {
    commits: items.filter((i) => i.kind === "commit").length,
    prsMerged: items.filter((i) => i.kind === "pull_request" && i.state === "merged").length,
    releases: items.filter((i) => i.kind === "release").length,
    deploysOk: wk.filter((d) => d.status === "ready").length,
    deploysFailed: wk.filter((d) => d.status === "error").length,
    workflowsFailed: items.filter((i) => i.kind === "workflow_run" && i.state === "failure").length,
  };
  const improvements: string[] = [];
  const problems: string[] = [];
  for (const f of finance) {
    if (f.netRevenue > f.prevNetRevenue && f.prevNetRevenue > 0) improvements.push(`Ingresos netos en ${f.currency} subieron de ${formatMoney(f.prevNetRevenue, f.currency)} a ${formatMoney(f.netRevenue, f.currency)}.`);
    if (f.netRevenue < f.prevNetRevenue) problems.push(`Ingresos netos en ${f.currency} bajaron de ${formatMoney(f.prevNetRevenue, f.currency)} a ${formatMoney(f.netRevenue, f.currency)}.`);
    if (f.expenses > f.prevExpenses * 1.3 && f.prevExpenses > 0) problems.push(`Gastos en ${f.currency} subieron ${Math.round((f.expenses / f.prevExpenses - 1) * 100)}%.`);
  }
  if (tasksDone.length) improvements.push(`${tasksDone.length} tarea(s) completadas.`);
  if (development.prsMerged) improvements.push(`${development.prsMerged} PR(s) fusionados y ${development.releases} release(s).`);
  if (development.deploysFailed) problems.push(`${development.deploysFailed} deploy(s) fallidos.`);
  for (const a of alerts.filter((x) => x.first_seen_at.slice(0, 10) >= period.from && x.severity !== "info").slice(0, 5)) problems.push(a.title);
  const priorities = [
    ...top.map((t) => ({ title: t.task.title, reason: `Smart Priority ${t.result.score}/100${t.project ? ` · ${t.project}` : ""}` })),
    ...insights.filter((i) => i.topic !== "priority" && i.weight >= 35).slice(0, 3).map((i) => ({ title: i.recommendation, reason: i.reason })),
  ].slice(0, 7);
  return { generatedAt: new Date().toISOString(), demo: activeProfile() === "demo", period, previous, finance, topProjects, campaigns, tasksDone, development, improvements, problems, priorities };
}

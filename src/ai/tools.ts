/**
 * Typed, validated internal tools. The assistant (and the local engine) only see data through
 * these functions; each one belongs to a privacy category that the user can switch off.
 */
import { z } from "zod";
import { listProjects, getProject, listRepositories } from "@/repos/projects";
import { listTransactions, listRecurring, listRates } from "@/repos/finance";
import { listTasks } from "@/repos/tasks";
import { listAlerts } from "@/repos/alerts";
import { listCampaigns, listAdMetrics } from "@/repos/marketing";
import { listDevItems, listDeployments, listHealthChecks, listHealthResults } from "@/repos/dev";
import { listObservations } from "@/repos/metrics";
import { summarize, byProject, burnRate, type Breakdown } from "@/domain/finance";
import { aggregate, findings } from "@/domain/ads";
import { previousRange, rangeFor, type RangePreset } from "@/domain/periods";
import { scoreTask, DEFAULT_WEIGHTS, type PriorityWeights } from "@/domain/priorities";
import { getPref } from "@/repos/core";
import { addDays, todayStr } from "@/lib/util";
import { activeProfile } from "@/db";
import type { DataCategory } from "./settings";

const period = z.enum(["7d", "30d", "90d", "year"]).default("30d");

const compact = (b: Breakdown) => ({
  netRevenue: b.netRevenue / 100,
  collected: b.collected / 100,
  refunds: b.refunds / 100,
  fees: b.fees / 100,
  operatingExpenses: b.operatingExpenses / 100,
  adSpend: b.adSpend / 100,
  investment: b.investment / 100,
  operatingProfit: b.operatingProfit / 100,
  cashFlow: b.cashFlow / 100,
  transactions: b.count,
});
const perCurrency = (s: Record<string, Breakdown>) => Object.fromEntries(Object.entries(s).map(([c, b]) => [c, compact(b)]));

export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  category: DataCategory;
  schema: S;
  run: (args: z.infer<S>) => Promise<unknown>;
}

const def = <S extends z.ZodTypeAny>(t: ToolDef<S>) => t as unknown as ToolDef;

export async function smartTasks(limit = 15, projectId?: string) {
  const [tasks, projects, weights] = await Promise.all([listTasks(), listProjects(), getPref<PriorityWeights>("tasks.weights", DEFAULT_WEIGHTS)]);
  const launchDates = Object.fromEntries(projects.map((p) => [p.id, p.target_launch_on]));
  const today = todayStr();
  return tasks
    .filter((t) => !["done", "canceled"].includes(t.status) && !t.parent_id && (!projectId || t.project_id === projectId))
    .map((t) => ({ task: t, result: scoreTask(t, { today, tasks, launchDates }, weights), project: projects.find((p) => p.id === t.project_id)?.name ?? null }))
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, limit);
}

export const TOOLS: ToolDef[] = [
  def({
    name: "listProjects",
    description: "Lista los proyectos registrados con estado, tipo, prioridad, última actividad y fecha objetivo de lanzamiento.",
    category: "projects",
    schema: z.object({ status: z.string().optional() }),
    run: async ({ status }) =>
      (await listProjects())
        .filter((p) => !status || p.status === status)
        .map((p) => ({ id: p.id, name: p.name, type: p.type, category: p.category, status: p.status, priority: p.priority, last_activity_at: p.last_activity_at, target_launch_on: p.target_launch_on, hosting: p.hosting, monetization: p.monetization_model })),
  }),
  def({
    name: "getProjectDetails",
    description: "Detalle de un proyecto: stack, repositorios, despliegues recientes, health checks y tareas abiertas.",
    category: "projects",
    schema: z.object({ projectId: z.string().min(1) }),
    run: async ({ projectId }) => {
      const p = await getProject(projectId);
      if (!p) return { error: "Proyecto no encontrado" };
      const [repos, deploys, tasks, checks] = await Promise.all([listRepositories(), listDeployments({ projectId, limit: 5 }), listTasks(), listHealthChecks()]);
      const health = await Promise.all(checks.filter((c) => c.project_id === projectId).map(async (c) => ({ name: c.name, last: (await listHealthResults(c.id, 1))[0] ?? null })));
      return {
        project: { ...p, logo_data: undefined, notes: p.notes?.slice(0, 500) },
        repositories: repos.filter((r) => r.project_id === projectId).map((r) => ({ name: r.full_name ?? r.canonical_key, last_commit_at: r.last_commit_at, open_prs: r.open_prs, open_issues: r.open_issues })),
        deployments: deploys.map((d) => ({ provider: d.provider, status: d.status, env: d.environment, at: d.created_at_ext })),
        health,
        openTasks: tasks.filter((t) => t.project_id === projectId && !["done", "canceled"].includes(t.status)).length,
      };
    },
  }),
  def({
    name: "getFinancialSummary",
    description: "Resumen financiero por moneda (sin mezclar monedas) del período y del período anterior, más ranking por proyecto.",
    category: "finance",
    schema: z.object({ period, projectId: z.string().optional() }),
    run: async ({ period: p, projectId }) => {
      const range = rangeFor(p as RangePreset);
      const prev = previousRange(range);
      const txs = await listTransactions({ from: prev.from, projectId });
      const projects = await listProjects();
      const all = await listTransactions({ projectId });
      return {
        period: range,
        current: perCurrency(summarize(txs, range)),
        previous: perCurrency(summarize(txs, prev)),
        byProject: byProject(txs, range).map((x) => ({ project: projects.find((pr) => pr.id === x.projectId)?.name ?? "Sin proyecto", ...perCurrency(x.summary) })),
        burnRateMonthly: Object.fromEntries(["USD", "ARS"].map((c) => [c, burnRate(all, c, todayStr().slice(0, 7))])),
        note: "Importes en unidades de cada moneda. Ingreso ≠ ganancia: operatingProfit descuenta comisiones y gastos; investment se informa aparte.",
      };
    },
  }),
  def({
    name: "getTransactions",
    description: "Transacciones (ingresos, gastos, comisiones, reembolsos, inversiones) filtradas.",
    category: "finance",
    schema: z.object({ from: z.string().optional(), to: z.string().optional(), projectId: z.string().optional(), kind: z.enum(["income", "expense", "refund", "fee", "investment"]).optional(), limit: z.number().int().min(1).max(100).default(50) }),
    run: async (a) =>
      (await listTransactions({ from: a.from, to: a.to, projectId: a.projectId, kind: a.kind }))
        .slice(0, a.limit)
        .map((t) => ({ date: t.occurred_on, kind: t.kind, category: t.category, amount: t.amount_minor / 100, currency: t.currency, status: t.status, description: t.description, project_id: t.project_id, source: t.source })),
  }),
  def({
    name: "getRecurringCosts",
    description: "Costos recurrentes y suscripciones operativas con próximo vencimiento.",
    category: "finance",
    schema: z.object({}),
    run: async () => (await listRecurring()).map((r) => ({ name: r.name, vendor: r.vendor, amount: r.amount_minor / 100, currency: r.currency, interval: r.interval, next_due_on: r.next_due_on, active: r.active, project_id: r.project_id })),
  }),
  def({
    name: "getCampaignPerformance",
    description: "Rendimiento de campañas publicitarias en el período y el anterior (solo métricas reportadas por la plataforma) y hallazgos.",
    category: "marketing",
    schema: z.object({ period }),
    run: async ({ period: p }) => {
      const range = rangeFor(p as RangePreset);
      const prev = previousRange(range);
      const [camps, rows] = await Promise.all([listCampaigns(), listAdMetrics(prev.from, range.to)]);
      const cur: Record<string, ReturnType<typeof aggregate>> = {};
      const old: Record<string, ReturnType<typeof aggregate>> = {};
      for (const c of camps) {
        const r = rows.filter((x) => x.campaign_id === c.id);
        cur[c.id] = aggregate(r, range);
        old[c.id] = aggregate(r, prev);
      }
      return {
        period: range,
        campaigns: camps.map((c) => ({ id: c.id, name: c.name, platform: c.platform, status: c.status, currency: c.currency, project_id: c.project_id, current: cur[c.id], previous: old[c.id] })),
        findings: findings(camps, cur, old),
        note: "Montos en unidades menores (centavos). null = la plataforma no reporta ese dato.",
      };
    },
  }),
  def({
    name: "getAnalytics",
    description: "Métricas de producto registradas (usuarios, MRR, sesiones, etc.) con fuente y período.",
    category: "analytics",
    schema: z.object({ projectId: z.string().optional(), metricKey: z.string().optional() }),
    run: async (a) => (await listObservations({ projectId: a.projectId, metricKey: a.metricKey })).slice(-200).map((o) => ({ metric: o.metric_key, value: o.value, unit: o.unit, currency: o.currency, period: `${o.period_start}..${o.period_end}`, source: o.source, project_id: o.project_id })),
  }),
  def({
    name: "getDevelopmentActivity",
    description: "Actividad de desarrollo de los últimos días: commits, PRs, issues, workflows fallidos, releases y despliegues por proyecto.",
    category: "development",
    schema: z.object({ days: z.number().int().min(1).max(90).default(14), projectId: z.string().optional() }),
    run: async ({ days, projectId }) => {
      const since = addDays(todayStr(), -days);
      const [items, deploys, projects] = await Promise.all([listDevItems({ projectId, since, limit: 1000 }), listDeployments({ projectId, limit: 200 }), listProjects()]);
      const per = new Map<string, Record<string, number>>();
      for (const i of items) {
        const k = projects.find((p) => p.id === i.project_id)?.name ?? "Sin proyecto";
        const m = per.get(k) ?? {};
        const key = i.kind === "pull_request" ? `pr_${i.state}` : i.kind === "workflow_run" ? `workflow_${i.state}` : i.kind === "issue" ? `issue_${i.state}` : i.kind;
        m[key] = (m[key] ?? 0) + 1;
        per.set(k, m);
      }
      return {
        since,
        perProject: Object.fromEntries(per),
        deployments: deploys.filter((d) => d.created_at_ext >= since).map((d) => ({ project: projects.find((p) => p.id === d.project_id)?.name, provider: d.provider, status: d.status, env: d.environment, at: d.created_at_ext })),
        projectsWithoutActivity: projects.filter((p) => !["archived", "idea", "paused"].includes(p.status) && (!p.last_activity_at || p.last_activity_at < since)).map((p) => ({ name: p.name, last_activity_at: p.last_activity_at })),
      };
    },
  }),
  def({
    name: "getOutstandingTasks",
    description: "Tareas pendientes ordenadas por Smart Priority, con los factores usados.",
    category: "tasks",
    schema: z.object({ projectId: z.string().optional(), limit: z.number().int().min(1).max(50).default(15) }),
    run: async ({ projectId, limit }) =>
      (await smartTasks(limit, projectId)).map((x) => ({ title: x.task.title, project: x.project, status: x.task.status, due_on: x.task.due_on, priority: x.task.priority, score: x.result.score, blocked: x.result.blocked, factors: x.result.factors.map((f) => `${f.key}: ${f.note}`) })),
  }),
  def({
    name: "getAlerts",
    description: "Alertas abiertas generadas por reglas verificables, con su evidencia.",
    category: "alerts",
    schema: z.object({}),
    run: async () => (await listAlerts("open")).map((a) => ({ severity: a.severity, title: a.title, detail: a.detail, rule: a.rule_id, evidence: a.evidence, since: a.first_seen_at })),
  }),
  def({
    name: "comparePeriods",
    description: "Compara una métrica entre el período actual y el anterior de igual duración.",
    category: "finance",
    schema: z.object({ metric: z.enum(["net_revenue", "operating_expenses", "operating_profit", "ad_spend", "fees"]), period }),
    run: async ({ metric, period: p }) => {
      const range = rangeFor(p as RangePreset);
      const prev = previousRange(range);
      const txs = await listTransactions({ from: prev.from });
      const field = ({ net_revenue: "netRevenue", operating_expenses: "operatingExpenses", operating_profit: "operatingProfit", ad_spend: "adSpend", fees: "fees" } as const)[metric as "fees"];
      const cur = summarize(txs, range);
      const old = summarize(txs, prev);
      const currencies = [...new Set([...Object.keys(cur), ...Object.keys(old)])];
      return { metric, current: range, previous: prev, values: Object.fromEntries(currencies.map((c) => [c, { current: (cur[c]?.[field] ?? 0) / 100, previous: (old[c]?.[field] ?? 0) / 100 }])) };
    },
  }),
  def({
    name: "getExchangeRates",
    description: "Tipos de cambio registrados (fuente y fecha).",
    category: "finance",
    schema: z.object({}),
    run: async () => (await listRates()).slice(0, 10).map((r) => ({ pair: `${r.base}/${r.quote}`, rate: r.rate, as_of: r.as_of, source: r.source })),
  }),
];

export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);

export async function executeTool(name: string, rawArgs: unknown, allowed: Record<DataCategory, boolean>): Promise<{ ok: boolean; result: unknown }> {
  const tool = toolByName(name);
  if (!tool) return { ok: false, result: { error: `Herramienta desconocida: ${name}` } };
  if (!allowed[tool.category]) return { ok: false, result: { error: `La categoría "${tool.category}" está desactivada en la configuración de privacidad. No hay acceso a estos datos.` } };
  const parsed = tool.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) return { ok: false, result: { error: "Argumentos inválidos", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) } };
  try {
    const result = await tool.run(parsed.data);
    return { ok: true, result: activeProfile() === "demo" ? { demo_mode: "Datos de DEMOSTRACIÓN, no reales", data: result } : result };
  } catch (e) {
    return { ok: false, result: { error: (e as Error).message } };
  }
}

export function toolJsonSchema(t: ToolDef): Record<string, unknown> {
  const schema = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

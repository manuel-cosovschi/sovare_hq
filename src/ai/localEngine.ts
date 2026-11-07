/**
 * Local insight engine — deterministic rules over the same typed data, no external API needed.
 * Every insight states recommendation, reason, evidence, confidence and its epistemic type.
 */
import { listProjects, listRepositories } from "@/repos/projects";
import { listTransactions, listRecurring } from "@/repos/finance";
import { listAlerts } from "@/repos/alerts";
import { listCampaigns, listAdMetrics } from "@/repos/marketing";
import { listMilestones, listTasks } from "@/repos/tasks";
import { byProject, monthlyEquivalent, revenueConcentration } from "@/domain/finance";
import { aggregate, findings } from "@/domain/ads";
import { previousRange, rangeFor } from "@/domain/periods";
import { formatMoney } from "@/domain/money";
import { categoryLabel } from "@/domain/categories";
import { ACTIVE_STATUSES, LIVE_STATUSES } from "@/domain/types";
import { addDays, daysBetween, todayStr } from "@/lib/util";
import { smartTasks } from "./tools";

export type Confidence = "alta" | "media" | "baja";
export type Epistemic = "hecho" | "estimación" | "hipótesis";

export interface Insight {
  id: string;
  topic: "priority" | "finance" | "marketing" | "development" | "operations" | "data";
  recommendation: string;
  reason: string;
  evidence: string[];
  impact: string | null;
  confidence: Confidence;
  type: Epistemic;
  action: string;
  link: string | null;
  weight: number; // for ranking "today's 3 actions"
}

export async function generateInsights(today = todayStr()): Promise<Insight[]> {
  const out: Insight[] = [];
  const [projects, alerts, txs, recurring, camps, tasks, milestones, repos] = await Promise.all([
    listProjects(),
    listAlerts("open"),
    listTransactions({ from: addDays(today, -180) }),
    listRecurring(),
    listCampaigns(),
    listTasks(),
    listMilestones(),
    listRepositories(),
  ]);
  const pname = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "Sin proyecto";

  // 1. Critical / warning alerts
  for (const a of alerts.filter((x) => x.severity !== "info").slice(0, 5))
    out.push({
      id: `alert:${a.id}`,
      topic: "operations",
      recommendation: `Atender: ${a.title}`,
      reason: a.detail ?? "Alerta generada por una regla verificable.",
      evidence: [`Regla "${a.rule_id}" · detectada ${a.first_seen_at.slice(0, 10)}`],
      impact: null,
      confidence: "alta",
      type: "hecho",
      action: "Abrir el detalle y resolver o descartar la alerta.",
      link: a.link,
      weight: a.severity === "critical" ? 100 : 70,
    });

  // 2. Profitability by project (last 90 days), per currency
  const r90 = { from: addDays(today, -89), to: today };
  const pf = byProject(txs, r90);
  for (const cur of ["USD", "ARS"]) {
    const ranked = pf
      .map((x) => ({ id: x.projectId, b: x.summary[cur] }))
      .filter((x) => x.b && (x.b.netRevenue > 0 || x.b.operatingExpenses > 0));
    if (!ranked.length) continue;
    const best = [...ranked].sort((a, b) => b.b.operatingProfit - a.b.operatingProfit)[0];
    if (best.b.netRevenue > 0)
      out.push({
        id: `profit:${cur}`,
        topic: "finance",
        recommendation: `${pname(best.id)} es el proyecto con mayor beneficio operativo en ${cur} (90 días)`,
        reason: "Comparación del beneficio operativo registrado por proyecto.",
        evidence: [`Ingresos netos ${formatMoney(best.b.netRevenue, cur)}`, `Gastos + comisiones ${formatMoney(best.b.operatingExpenses + best.b.fees, cur)}`, `Beneficio ${formatMoney(best.b.operatingProfit, cur)}`],
        impact: null,
        confidence: "alta",
        type: "hecho",
        action: "Protegé lo que funciona: revisá sus costos y oportunidades de crecimiento.",
        link: best.id ? `/projects/${best.id}` : "/finance",
        weight: 30,
      });
    const worst = [...ranked].sort((a, b) => a.b.operatingProfit - b.b.operatingProfit)[0];
    if (worst.b.operatingProfit < 0 && worst.id !== best.id)
      out.push({
        id: `loss:${cur}:${worst.id}`,
        topic: "finance",
        recommendation: `${pname(worst.id)} tiene beneficio operativo negativo en ${cur}`,
        reason: "Sus gastos registrados superan a sus ingresos netos en los últimos 90 días.",
        evidence: [`Beneficio ${formatMoney(worst.b.operatingProfit, cur)}`, `Gastos ${formatMoney(worst.b.operatingExpenses, cur)}`],
        impact: `Reducir costos podría ahorrar hasta ${formatMoney(worst.b.operatingExpenses, cur)} por trimestre (máximo teórico).`,
        confidence: "media",
        type: "estimación",
        action: "Revisá qué gastos son imprescindibles y si el proyecto tiene un plan de monetización.",
        link: worst.id ? `/projects/${worst.id}` : "/finance",
        weight: 45,
      });
  }

  // 3. Where the money goes (last 30 days)
  const r30 = { from: addDays(today, -29), to: today };
  const byCat = new Map<string, Map<string, number>>();
  for (const t of txs.filter((x) => (x.kind === "expense" || x.kind === "fee") && x.occurred_on >= r30.from)) {
    const m = byCat.get(t.currency) ?? new Map();
    m.set(t.category, (m.get(t.category) ?? 0) + t.amount_minor);
    byCat.set(t.currency, m);
  }
  for (const [cur, m] of byCat) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [cat, amt] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (total > 0 && amt / total >= 0.4)
      out.push({
        id: `spend:${cur}`,
        topic: "finance",
        recommendation: `El ${Math.round((amt / total) * 100)}% del gasto en ${cur} es ${categoryLabel(cat)}`,
        reason: "Concentración del gasto de los últimos 30 días.",
        evidence: [`${categoryLabel(cat)}: ${formatMoney(amt, cur)} de ${formatMoney(total, cur)}`],
        impact: null,
        confidence: "alta",
        type: "hecho",
        action: "Verificá que ese gasto esté generando resultados medibles.",
        link: "/finance?tab=intelligence",
        weight: 25,
      });
  }

  // 4. Revenue concentration risk
  for (const cur of ["USD", "ARS"]) {
    const rc = revenueConcentration(txs, cur, r90);
    if (rc && rc.share >= 0.75 && pf.filter((p) => (p.summary[cur]?.netRevenue ?? 0) > 0).length >= 2)
      out.push({
        id: `conc:${cur}`,
        topic: "finance",
        recommendation: `Dependencia alta de ${pname(rc.projectId)} (${Math.round(rc.share * 100)}% de los ingresos en ${cur})`,
        reason: "Una caída en ese proyecto afectaría la mayor parte de tus ingresos.",
        evidence: ["Participación en ingresos netos de los últimos 90 días"],
        impact: null,
        confidence: "media",
        type: "hipótesis",
        action: "Considerá acelerar la monetización de un segundo proyecto.",
        link: "/finance?tab=intelligence",
        weight: 20,
      });
  }

  // 5. Inactive active projects
  for (const p of projects.filter((x) => ACTIVE_STATUSES.includes(x.status) && !LIVE_STATUSES.includes(x.status))) {
    const days = p.last_activity_at ? daysBetween(p.last_activity_at.slice(0, 10), today) : null;
    if (days !== null && days >= 21)
      out.push({
        id: `stale:${p.id}`,
        topic: "development",
        recommendation: `${p.name} lleva ${days} días sin avances`,
        reason: `Está en "${p.status}" pero no registra commits, tareas ni eventos recientes.`,
        evidence: [`Última actividad: ${p.last_activity_at!.slice(0, 10)}`],
        impact: null,
        confidence: "alta",
        type: "hecho",
        action: "Decidí: retomarlo con una próxima tarea concreta, o pasarlo a Paused para liberar foco.",
        link: `/projects/${p.id}`,
        weight: 35,
      });
  }

  // 6. Closest to launch (milestones / tasks defined)
  const prelaunch = projects.filter((p) => ["planning", "design", "development", "testing", "beta"].includes(p.status));
  const readiness = prelaunch
    .map((p) => {
      const pt = tasks.filter((t) => t.project_id === p.id && !t.parent_id && t.status !== "canceled");
      const done = pt.filter((t) => t.status === "done").length;
      const ms = milestones.filter((m) => m.project_id === p.id && m.status !== "canceled");
      return { p, total: pt.length, done, open: pt.length - done, milestonesOpen: ms.filter((m) => m.status !== "done").length };
    })
    .filter((x) => x.total >= 3)
    .sort((a, b) => a.open - b.open || (a.p.target_launch_on ?? "9999").localeCompare(b.p.target_launch_on ?? "9999"));
  if (readiness[0])
    out.push({
      id: `launch:${readiness[0].p.id}`,
      topic: "priority",
      recommendation: `${readiness[0].p.name} es el más cercano a lanzarse`,
      reason: "Tiene la menor cantidad de tareas pendientes entre los proyectos pre-lanzamiento con roadmap definido.",
      evidence: [`${readiness[0].done}/${readiness[0].total} tareas completadas`, `${readiness[0].milestonesOpen} hitos abiertos`, readiness[0].p.target_launch_on ? `Fecha objetivo ${readiness[0].p.target_launch_on}` : "Sin fecha objetivo"],
      impact: null,
      confidence: "media",
      type: "estimación",
      action: "Cerrá las tareas restantes y definí la fecha de lanzamiento.",
      link: `/projects/${readiness[0].p.id}`,
      weight: 40,
    });

  // 7. Top smart-priority tasks
  for (const s of (await smartTasks(3)).filter((x) => !x.result.blocked))
    out.push({
      id: `task:${s.task.id}`,
      topic: "priority",
      recommendation: `Trabajar en: ${s.task.title}`,
      reason: `Smart Priority ${s.result.score}/100${s.project ? ` · ${s.project}` : ""}.`,
      evidence: s.result.factors.filter((f) => f.value >= 0.6).map((f) => f.note).slice(0, 3),
      impact: null,
      confidence: "media",
      type: "estimación",
      action: "Abrí la tarea y movela a En curso.",
      link: `/tasks?task=${s.task.id}`,
      weight: 50 + s.result.score / 4,
    });

  // 8. Marketing findings
  const range = rangeFor("7d", undefined, today);
  const prev = previousRange(range);
  const metrics = await listAdMetrics(prev.from, range.to);
  const cur: Record<string, ReturnType<typeof aggregate>> = {};
  const old: Record<string, ReturnType<typeof aggregate>> = {};
  for (const c of camps) {
    const rows = metrics.filter((m) => m.campaign_id === c.id);
    cur[c.id] = aggregate(rows, range);
    old[c.id] = aggregate(rows, prev);
  }
  for (const f of findings(camps, cur, old).slice(0, 4))
    out.push({
      id: `ads:${f.campaignId}:${f.kind}`,
      topic: "marketing",
      recommendation: f.message,
      reason: f.basis,
      evidence: ["Métricas reportadas por la plataforma (últimos 7 días vs 7 previos)"],
      impact: null,
      confidence: f.kind === "no_conversions" ? "alta" : "media",
      type: f.kind === "spend_concentration" ? "hecho" : "hipótesis",
      action: "Revisá segmentación, creatividades y página de destino antes de seguir invirtiendo.",
      link: `/marketing?campaign=${f.campaignId}`,
      weight: f.kind === "no_conversions" ? 55 : 30,
    });

  // 9. Recurring costs on paused/archived projects
  for (const rc of recurring.filter((r) => r.active && r.project_id)) {
    const p = projects.find((x) => x.id === rc.project_id);
    if (p && ["paused", "archived"].includes(p.status))
      out.push({
        id: `rc:${rc.id}`,
        topic: "finance",
        recommendation: `Revisar ${rc.name}: el proyecto ${p.name} está ${p.status}`,
        reason: "Costo recurrente activo asociado a un proyecto sin operación.",
        evidence: [`${formatMoney(monthlyEquivalent(rc.amount_minor, rc.interval), rc.currency)} / mes equivalente`],
        impact: `Ahorro potencial de ${formatMoney(monthlyEquivalent(rc.amount_minor, rc.interval) * 12, rc.currency)} al año`,
        confidence: "media",
        type: "estimación",
        action: "Cancelá o pausá la suscripción si ya no se necesita.",
        link: "/finance?tab=recurring",
        weight: 30,
      });
  }

  // 10. Missing data → what to connect
  if (!txs.length)
    out.push({ id: "data:finance", topic: "data", recommendation: "Registrá ingresos y gastos para habilitar el análisis financiero", reason: "No hay transacciones en los últimos 180 días.", evidence: [], impact: null, confidence: "alta", type: "hecho", action: "Conectá Mercado Pago o Stripe, o importá un CSV.", link: "/integrations", weight: 15 });
  if (!repos.length)
    out.push({ id: "data:github", topic: "data", recommendation: "Conectá GitHub para medir la actividad de desarrollo", reason: "No hay repositorios sincronizados.", evidence: [], impact: null, confidence: "alta", type: "hecho", action: "Integrations → GitHub.", link: "/integrations?open=github", weight: 12 });
  if (!camps.length)
    out.push({ id: "data:ads", topic: "data", recommendation: "Sin datos de publicidad", reason: "No hay campañas sincronizadas o importadas.", evidence: [], impact: null, confidence: "alta", type: "hecho", action: "Conectá Meta Ads o importá un CSV de campañas.", link: "/integrations?open=meta_ads", weight: 5 });
  if (!projects.length)
    out.push({ id: "data:projects", topic: "data", recommendation: "Registrá tus proyectos", reason: "Todavía no hay proyectos.", evidence: [], impact: null, confidence: "alta", type: "hecho", action: "Projects → Nuevo proyecto o Descubrir.", link: "/projects", weight: 90 });

  return out.sort((a, b) => b.weight - a.weight);
}

export function topActions(insights: Insight[], n = 3): Insight[] {
  const seen = new Set<string>();
  return insights.filter((i) => i.topic !== "data" || insights.length < 4).filter((i) => (seen.has(i.topic + i.link) ? false : (seen.add(i.topic + i.link), true))).slice(0, n);
}

// ---------- local answers to preset questions ----------
export const PRESET_QUESTIONS: Array<{ id: string; q: string; topics: Insight["topic"][] }> = [
  { id: "priority", q: "¿Qué proyecto debería priorizar esta semana?", topics: ["priority", "operations"] },
  { id: "profit", q: "¿Cuál está generando más ganancias?", topics: ["finance"] },
  { id: "stale", q: "¿Qué aplicaciones llevan mucho tiempo sin avances?", topics: ["development"] },
  { id: "spend", q: "¿Dónde se está gastando más dinero?", topics: ["finance"] },
  { id: "sales", q: "¿Qué acciones podrían mejorar mis ventas?", topics: ["marketing", "finance"] },
  { id: "costs", q: "¿Qué costos podría reducir?", topics: ["finance"] },
  { id: "launch", q: "¿Qué proyecto está más cerca de poder lanzarse?", topics: ["priority"] },
  { id: "ads", q: "¿Qué cambió en mis campañas publicitarias?", topics: ["marketing"] },
  { id: "urgent", q: "¿Qué pendientes son más urgentes?", topics: ["priority", "operations"] },
];

const PRESET_FILTER: Record<string, (i: Insight) => boolean> = {
  priority: (i) => i.topic === "priority" || (i.topic === "operations" && i.weight >= 70),
  profit: (i) => i.id.startsWith("profit:") || i.id.startsWith("loss:") || i.id.startsWith("conc:"),
  stale: (i) => i.id.startsWith("stale:"),
  spend: (i) => i.id.startsWith("spend:") || i.id.startsWith("loss:"),
  sales: (i) => i.topic === "marketing" || i.id.startsWith("conc:") || i.id.startsWith("profit:"),
  costs: (i) => i.id.startsWith("rc:") || i.id.startsWith("spend:") || i.id.startsWith("loss:") || i.id.startsWith("ads:"),
  launch: (i) => i.id.startsWith("launch:"),
  ads: (i) => i.topic === "marketing" || i.id === "data:ads",
  urgent: (i) => i.id.startsWith("task:") || i.id.startsWith("alert:"),
};

export async function answerPreset(id: string): Promise<{ insights: Insight[]; empty: string | null }> {
  const all = await generateInsights();
  const f = PRESET_FILTER[id] ?? (() => false);
  const insights = all.filter(f);
  const empties: Record<string, string> = {
    profit: "No hay ingresos registrados en los últimos 90 días: no se puede determinar el proyecto más rentable. Registrá ventas o conectá Stripe / Mercado Pago.",
    stale: "Ningún proyecto activo supera los 21 días sin actividad registrada.",
    launch: "Ningún proyecto pre-lanzamiento tiene al menos 3 tareas definidas. Cargá el roadmap para estimar cuál está más cerca.",
    ads: "No hay campañas con métricas en los últimos 14 días. Conectá Meta Ads o importá un CSV.",
    spend: "No hay gastos registrados en los últimos 30 días.",
    costs: "No se detectaron costos evidentes para reducir con los datos actuales.",
  };
  return { insights, empty: insights.length ? null : empties[id] ?? "No hay datos suficientes para responder con evidencia." };
}

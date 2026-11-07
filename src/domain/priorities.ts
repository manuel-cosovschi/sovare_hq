/**
 * Smart Priorities: transparent, configurable task scoring. Every factor is shown to the user.
 */
import { daysBetween } from "@/lib/util";

export interface PriorityWeights {
  urgency: number;
  declared: number;
  impact: number;
  effort: number;
  dependencies: number;
  risk: number;
  launch: number;
}

export const DEFAULT_WEIGHTS: PriorityWeights = { urgency: 3, declared: 2, impact: 3, effort: 1, dependencies: 2, risk: 1, launch: 2 };

export const FACTOR_LABEL: Record<keyof PriorityWeights, string> = {
  urgency: "Urgencia (fecha límite)",
  declared: "Prioridad declarada",
  impact: "Impacto comercial",
  effort: "Esfuerzo estimado (menor = mejor)",
  dependencies: "Dependencias (desbloquea / bloqueada)",
  risk: "Riesgo",
  launch: "Proximidad al lanzamiento",
};

export interface ScorableTask {
  id: string;
  status: string;
  priority: string;
  due_on: string | null;
  impact: number | null;
  effort: number | null;
  risk: number | null;
  depends_on: string[];
  project_id: string | null;
}

export interface Factor {
  key: keyof PriorityWeights;
  value: number; // 0..1
  weight: number;
  note: string;
}

export interface ScoreResult {
  score: number; // 0..100
  factors: Factor[];
  blocked: boolean;
}

const DECLARED: Record<string, number> = { urgent: 1, high: 0.75, medium: 0.5, low: 0.2 };

export function scoreTask(
  t: ScorableTask,
  ctx: { today: string; tasks: ScorableTask[]; launchDates: Record<string, string | null> },
  w: PriorityWeights = DEFAULT_WEIGHTS,
): ScoreResult {
  const factors: Factor[] = [];
  // urgency
  let urgency = 0.15;
  let uNote = "Sin fecha límite";
  if (t.due_on) {
    const d = daysBetween(ctx.today, t.due_on);
    urgency = d < 0 ? 1 : Math.max(0, 1 - d / 14);
    uNote = d < 0 ? `Vencida hace ${-d} d` : d === 0 ? "Vence hoy" : `Vence en ${d} d`;
  }
  factors.push({ key: "urgency", value: urgency, weight: w.urgency, note: uNote });
  factors.push({ key: "declared", value: DECLARED[t.priority] ?? 0.5, weight: w.declared, note: t.priority });
  factors.push({
    key: "impact",
    value: t.impact ? (t.impact - 1) / 4 : 0.5,
    weight: w.impact,
    note: t.impact ? `${t.impact}/5` : "Sin dato (neutral)",
  });
  factors.push({
    key: "effort",
    value: t.effort ? (5 - t.effort) / 4 : 0.5,
    weight: w.effort,
    note: t.effort ? `${t.effort}/5` : "Sin dato (neutral)",
  });
  const open = new Set(ctx.tasks.filter((x) => !["done", "canceled"].includes(x.status)).map((x) => x.id));
  const blockedBy = t.depends_on.filter((id) => open.has(id));
  const unblocks = ctx.tasks.filter((x) => open.has(x.id) && x.depends_on.includes(t.id)).length;
  const blocked = blockedBy.length > 0;
  factors.push({
    key: "dependencies",
    value: blocked ? 0 : Math.min(1, 0.4 + unblocks * 0.3),
    weight: w.dependencies,
    note: blocked ? `Bloqueada por ${blockedBy.length} tarea(s)` : unblocks ? `Desbloquea ${unblocks} tarea(s)` : "Sin dependencias",
  });
  factors.push({ key: "risk", value: t.risk ? (t.risk - 1) / 4 : 0.3, weight: w.risk, note: t.risk ? `${t.risk}/5` : "Sin dato" });
  const launch = t.project_id ? ctx.launchDates[t.project_id] : null;
  let lv = 0;
  let lNote = "Sin fecha de lanzamiento";
  if (launch) {
    const d = daysBetween(ctx.today, launch);
    lv = d < 0 ? 1 : Math.max(0, 1 - d / 60);
    lNote = d < 0 ? "Lanzamiento atrasado" : `Lanzamiento en ${d} d`;
  }
  factors.push({ key: "launch", value: lv, weight: w.launch, note: lNote });
  const totalW = factors.reduce((s, f) => s + f.weight, 0) || 1;
  const score = Math.round((factors.reduce((s, f) => s + f.value * f.weight, 0) / totalW) * 100);
  return { score: blocked ? Math.round(score * 0.5) : score, factors, blocked };
}

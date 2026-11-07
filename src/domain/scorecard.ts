/**
 * Project scorecards: explicit criteria, half rated by the user, half computed from evidence.
 * Not a financial prediction — the UI states it.
 */
import type { Scorecard } from "./types";

export interface Criterion {
  key: string;
  label: string;
  value: number | null; // 0..5
  source: "manual" | "calculado";
  note: string;
}

export interface ScorecardInput {
  scorecard: Scorecard;
  netRevenue90d: number; // in project's main currency minor units (any currency > 0 counts)
  operatingProfit90d: number;
  daysSinceActivity: number | null;
  openTasks: number;
  doneTasks30d: number;
}

export function buildScorecard(i: ScorecardInput): { criteria: Criterion[]; total: number | null } {
  const c: Criterion[] = [
    { key: "market_potential", label: "Potencial de mercado", value: i.scorecard.market_potential ?? null, source: "manual", note: "Tu evaluación" },
    { key: "strategic_fit", label: "Encaje estratégico", value: i.scorecard.strategic_fit ?? null, source: "manual", note: "Tu evaluación" },
    { key: "technical_readiness", label: "Madurez técnica", value: i.scorecard.technical_readiness ?? null, source: "manual", note: "Tu evaluación" },
    {
      key: "effort_to_launch",
      label: "Facilidad para el próximo hito",
      value: i.scorecard.effort_to_launch != null ? 6 - i.scorecard.effort_to_launch : null,
      source: "manual",
      note: "Inverso del esfuerzo estimado",
    },
    {
      key: "revenue_traction",
      label: "Tracción de ingresos (90 d)",
      value: i.netRevenue90d > 0 ? (i.operatingProfit90d > 0 ? 5 : 3) : 0,
      source: "calculado",
      note: i.netRevenue90d > 0 ? (i.operatingProfit90d > 0 ? "Ingresos y beneficio positivos" : "Ingresos con beneficio ≤ 0") : "Sin ingresos registrados",
    },
    {
      key: "momentum",
      label: "Momentum de desarrollo",
      value: i.daysSinceActivity === null ? null : i.daysSinceActivity <= 7 ? 5 : i.daysSinceActivity <= 21 ? 4 : i.daysSinceActivity <= 60 ? 2 : 1,
      source: "calculado",
      note: i.daysSinceActivity === null ? "Sin actividad registrada" : `Última actividad hace ${i.daysSinceActivity} d · ${i.doneTasks30d} tareas cerradas en 30 d`,
    },
  ];
  const vals = c.map((x) => x.value).filter((v): v is number => v !== null);
  return { criteria: c, total: vals.length >= 3 ? Math.round((vals.reduce((a, b) => a + b, 0) / (vals.length * 5)) * 100) : null };
}

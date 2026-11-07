/**
 * Alert rules engine. Every rule is a pure function over a data snapshot, produces verifiable
 * evidence and a stable fingerprint (so an alert is not duplicated across evaluations).
 */
import { addDays, daysBetween } from "@/lib/util";
import { formatMoney, type Currency } from "./money";
import { summarize, type TxLike } from "./finance";
import type { Severity } from "./types";

export interface AlertSnapshot {
  today: string;
  projects: Array<{ id: string; name: string; status: string; last_activity_at: string | null; target_launch_on: string | null }>;
  deployments: Array<{ project_id: string | null; provider: string; provider_project: string | null; status: string; created_at_ext: string; external_id: string; inspect_url: string | null }>;
  campaigns: Array<{ id: string; name: string; project_id: string | null; status: string; currency: string | null; spendWindow: number; conversionsWindow: number | null; spendMonth: number }>;
  txs: TxLike[];
  tasks: Array<{ id: string; title: string; status: string; priority: string; due_on: string | null; project_id: string | null }>;
  recurring: Array<{ id: string; name: string; next_due_on: string | null; amount_minor: number; currency: Currency; active: boolean; project_id: string | null }>;
  integrations: Array<{ id: string; name: string; enabled: boolean; status: string; last_success_at: string | null; last_error: string | null }>;
  health: Array<{ check_id: string; name: string; project_id: string | null; recent: Array<{ ok: boolean; checked_at: string; status_code: number | null; error: string | null }>; last_ok_at?: string | null }>;
  budgets: Array<{ project_id: string | null; month: string; currency: Currency; amount_minor: number }>;
}

export interface AlertCandidate {
  rule_id: string;
  fingerprint: string;
  project_id: string | null;
  severity: Severity;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  link: string | null;
}

export interface ParamDef {
  key: string;
  label: string;
  type: "number";
  default: number;
  min?: number;
}

export interface RuleDef {
  id: string;
  name: string;
  description: string;
  params: ParamDef[];
  evaluate: (s: AlertSnapshot, p: Record<string, number>) => AlertCandidate[];
}

const ACTIVE = ["development", "testing", "beta", "launched", "production", "maintenance"];
const projName = (s: AlertSnapshot, id: string | null) => s.projects.find((p) => p.id === id)?.name ?? "Sin proyecto";

export const RULES: RuleDef[] = [
  {
    id: "deploy_failed",
    name: "Despliegue fallido",
    description: "El último despliegue de un proyecto en un proveedor terminó con error.",
    params: [{ key: "days", label: "Considerar despliegues de los últimos (días)", type: "number", default: 7, min: 1 }],
    evaluate: (s, p) => {
      const latest = new Map<string, AlertSnapshot["deployments"][number]>();
      for (const d of s.deployments) {
        const k = `${d.provider}:${d.provider_project ?? d.project_id}`;
        const cur = latest.get(k);
        if (!cur || d.created_at_ext > cur.created_at_ext) latest.set(k, d);
      }
      const since = addDays(s.today, -p.days);
      return [...latest.values()]
        .filter((d) => d.status === "error" && d.created_at_ext.slice(0, 10) >= since)
        .map((d) => ({
          rule_id: "deploy_failed",
          fingerprint: `deploy_failed:${d.provider}:${d.external_id}`,
          project_id: d.project_id,
          severity: "critical",
          title: `Deploy fallido en ${projName(s, d.project_id)}`,
          detail: `El último deploy en ${d.provider} (${d.provider_project ?? "proyecto"}) terminó con error el ${d.created_at_ext.slice(0, 10)}.`,
          evidence: { provider: d.provider, deployment: d.external_id, created_at: d.created_at_ext },
          link: d.inspect_url,
        }));
    },
  },
  {
    id: "health_down",
    name: "Servicio no responde",
    description: "Los últimos chequeos de un health endpoint fallaron.",
    params: [{ key: "consecutive", label: "Fallos consecutivos", type: "number", default: 2, min: 1 }],
    evaluate: (s, p) =>
      s.health
        .filter((h) => h.recent.length >= p.consecutive && h.recent.slice(0, p.consecutive).every((r) => !r.ok))
        .map((h) => ({
          rule_id: "health_down",
          // one alert per outage: keyed on the last successful check before it (stable while it stays down)
          fingerprint: `health_down:${h.check_id}:${(h.last_ok_at !== undefined ? h.last_ok_at : h.recent.find((r) => r.ok)?.checked_at) ?? "never"}`,
          project_id: h.project_id,
          severity: "critical",
          title: `${h.name} no responde correctamente`,
          detail: `${p.consecutive} chequeos consecutivos fallidos. Último: ${h.recent[0].status_code ?? h.recent[0].error ?? "error"}.`,
          evidence: { check: h.check_id, last: h.recent[0] },
          link: "/development?tab=monitoring",
        })),
  },
  {
    id: "ad_no_conversions",
    name: "Publicidad sin conversiones",
    description: "Una campaña activa gastó por encima del umbral sin conversiones reportadas por la plataforma (solo si la plataforma reporta conversiones).",
    params: [
      { key: "days", label: "Ventana (días)", type: "number", default: 7, min: 1 },
      { key: "min_spend", label: "Gasto mínimo (unidades de moneda)", type: "number", default: 30, min: 0 },
    ],
    evaluate: (s, p) =>
      s.campaigns
        .filter((c) => /active/i.test(c.status) && c.conversionsWindow === 0 && c.spendWindow >= p.min_spend * 100)
        .map((c) => ({
          rule_id: "ad_no_conversions",
          fingerprint: `ad_no_conversions:${c.id}:${s.today.slice(0, 7)}`,
          project_id: c.project_id,
          severity: "warning",
          title: `"${c.name}" gasta sin conversiones`,
          detail: `${formatMoney(c.spendWindow, c.currency ?? "USD")} en ${p.days} días y 0 conversiones reportadas.`,
          evidence: { campaign: c.id, spend_minor: c.spendWindow, conversions: 0, window_days: p.days },
          link: "/marketing",
        })),
  },
  {
    id: "ad_spend_threshold",
    name: "Campaña supera umbral de gasto mensual",
    description: "El gasto del mes de una campaña supera el umbral configurado.",
    params: [{ key: "max_month", label: "Umbral mensual (unidades de moneda)", type: "number", default: 300, min: 0 }],
    evaluate: (s, p) =>
      s.campaigns
        .filter((c) => c.spendMonth > p.max_month * 100)
        .map((c) => ({
          rule_id: "ad_spend_threshold",
          fingerprint: `ad_spend_threshold:${c.id}:${s.today.slice(0, 7)}`,
          project_id: c.project_id,
          severity: "warning",
          title: `"${c.name}" superó el umbral de gasto`,
          detail: `Gasto del mes ${formatMoney(c.spendMonth, c.currency ?? "USD")} (umbral ${p.max_month}).`,
          evidence: { campaign: c.id, spend_month_minor: c.spendMonth },
          link: "/marketing",
        })),
  },
  {
    id: "project_inactive",
    name: "Proyecto sin actividad",
    description: "Un proyecto activo no registra actividad en el período configurado.",
    params: [{ key: "days", label: "Días sin actividad", type: "number", default: 21, min: 1 }],
    evaluate: (s, p) =>
      s.projects
        .filter((pr) => ACTIVE.includes(pr.status) && pr.last_activity_at && daysBetween(pr.last_activity_at.slice(0, 10), s.today) >= p.days)
        .map((pr) => {
          const d = daysBetween(pr.last_activity_at!.slice(0, 10), s.today);
          return {
            rule_id: "project_inactive",
            fingerprint: `project_inactive:${pr.id}:${pr.last_activity_at!.slice(0, 10)}`,
            project_id: pr.id,
            severity: "info" as Severity,
            title: `${pr.name} sin actividad hace ${d} días`,
            detail: `Estado "${pr.status}" pero la última actividad registrada fue el ${pr.last_activity_at!.slice(0, 10)}. ¿Revisar o pausar?`,
            evidence: { last_activity_at: pr.last_activity_at, days: d },
            link: `/projects/${pr.id}`,
          };
        }),
  },
  {
    id: "cost_spike",
    name: "Aumento anormal de costos",
    description: "Los gastos de los últimos 30 días superan a los 30 días previos por encima del porcentaje configurado.",
    params: [
      { key: "pct", label: "Aumento (%)", type: "number", default: 40, min: 1 },
      { key: "min_prev", label: "Gasto previo mínimo (unidades)", type: "number", default: 20, min: 0 },
    ],
    evaluate: (s, p) => {
      const cur = summarize(s.txs, { from: addDays(s.today, -29), to: s.today });
      const prev = summarize(s.txs, { from: addDays(s.today, -59), to: addDays(s.today, -30) });
      const out: AlertCandidate[] = [];
      for (const [c, b] of Object.entries(cur)) {
        const before = (prev[c]?.operatingExpenses ?? 0) + (prev[c]?.fees ?? 0);
        const now = b.operatingExpenses + b.fees;
        if (before >= p.min_prev * 100 && now > before * (1 + p.pct / 100)) {
          const pct = Math.round(((now - before) / before) * 100);
          out.push({
            rule_id: "cost_spike",
            fingerprint: `cost_spike:${c}:${s.today.slice(0, 7)}`,
            project_id: null,
            severity: "warning",
            title: `Costos en ${c} subieron ${pct}%`,
            detail: `Últimos 30 días: ${formatMoney(now, c)} vs ${formatMoney(before, c)} en los 30 previos.`,
            evidence: { currency: c, current_minor: now, previous_minor: before },
            link: "/finance",
          });
        }
      }
      return out;
    },
  },
  {
    id: "revenue_drop",
    name: "Caída de ventas",
    description: "Los ingresos netos de los últimos 30 días cayeron respecto de los 30 días previos.",
    params: [
      { key: "pct", label: "Caída (%)", type: "number", default: 30, min: 1 },
      { key: "min_prev", label: "Ingreso previo mínimo (unidades)", type: "number", default: 50, min: 0 },
    ],
    evaluate: (s, p) => {
      const cur = summarize(s.txs, { from: addDays(s.today, -29), to: s.today });
      const prev = summarize(s.txs, { from: addDays(s.today, -59), to: addDays(s.today, -30) });
      const out: AlertCandidate[] = [];
      for (const [c, b] of Object.entries(prev)) {
        const before = b.netRevenue;
        const now = cur[c]?.netRevenue ?? 0;
        if (before >= p.min_prev * 100 && now < before * (1 - p.pct / 100)) {
          const pct = Math.round(((before - now) / before) * 100);
          out.push({
            rule_id: "revenue_drop",
            fingerprint: `revenue_drop:${c}:${s.today.slice(0, 7)}`,
            project_id: null,
            severity: "warning",
            title: `Ingresos en ${c} cayeron ${pct}%`,
            detail: `Últimos 30 días: ${formatMoney(now, c)} vs ${formatMoney(before, c)} en los 30 previos.`,
            evidence: { currency: c, current_minor: now, previous_minor: before },
            link: "/finance",
          });
        }
      }
      return out;
    },
  },
  {
    id: "task_overdue",
    name: "Tarea vencida",
    description: "Tareas no completadas cuya fecha límite ya pasó.",
    params: [],
    evaluate: (s) =>
      s.tasks
        .filter((t) => t.due_on && t.due_on < s.today && !["done", "canceled"].includes(t.status))
        .map((t) => ({
          rule_id: "task_overdue",
          fingerprint: `task_overdue:${t.id}:${t.due_on}`,
          project_id: t.project_id,
          severity: (["urgent", "high"].includes(t.priority) ? "warning" : "info") as Severity,
          title: `Tarea vencida: ${t.title}`,
          detail: `Venció el ${t.due_on} (${daysBetween(t.due_on!, s.today)} días).`,
          evidence: { task: t.id, due_on: t.due_on, priority: t.priority },
          link: "/tasks",
        })),
  },
  {
    id: "renewal_soon",
    name: "Renovación próxima",
    description: "Un costo recurrente vence dentro del período configurado.",
    params: [{ key: "days", label: "Anticipación (días)", type: "number", default: 7, min: 1 }],
    evaluate: (s, p) =>
      s.recurring
        .filter((r) => r.active && r.next_due_on && r.next_due_on >= s.today && r.next_due_on <= addDays(s.today, p.days))
        .map((r) => ({
          rule_id: "renewal_soon",
          fingerprint: `renewal_soon:${r.id}:${r.next_due_on}`,
          project_id: r.project_id,
          severity: "info",
          title: `${r.name} se renueva el ${r.next_due_on}`,
          detail: `Importe ${formatMoney(r.amount_minor, r.currency)}.`,
          evidence: { recurring: r.id, next_due_on: r.next_due_on },
          link: "/finance?tab=recurring",
        })),
  },
  {
    id: "integration_error",
    name: "Integración con error",
    description: "Una integración habilitada falló o no sincroniza hace más tiempo del configurado.",
    params: [{ key: "hours", label: "Horas sin sincronizar", type: "number", default: 48, min: 1 }],
    evaluate: (s, p) =>
      s.integrations
        .filter((i) => i.enabled)
        .flatMap((i) => {
          if (i.status === "error")
            return [{
              rule_id: "integration_error",
              fingerprint: `integration_error:${i.id}:${(i.last_error ?? "").slice(0, 40)}`,
              project_id: null,
              severity: "warning" as Severity,
              title: `Error en la integración ${i.name}`,
              detail: i.last_error ?? "La última sincronización falló. Los datos pueden estar desactualizados.",
              evidence: { integration: i.id },
              link: `/integrations?open=${i.id}`,
            }];
          if (i.last_success_at && (Date.parse(s.today + "T23:59:59") - Date.parse(i.last_success_at)) / 3_600_000 > p.hours)
            return [{
              rule_id: "integration_error",
              fingerprint: `integration_stale:${i.id}:${i.last_success_at.slice(0, 10)}`,
              project_id: null,
              severity: "info" as Severity,
              title: `${i.name} no sincroniza desde ${i.last_success_at.slice(0, 10)}`,
              detail: "Los datos de esta fuente pueden estar desactualizados.",
              evidence: { integration: i.id, last_success_at: i.last_success_at },
              link: `/integrations?open=${i.id}`,
            }];
          return [];
        }),
  },
  {
    id: "launch_soon",
    name: "Lanzamiento próximo",
    description: "Un proyecto tiene fecha objetivo de lanzamiento cercana y todavía no fue lanzado.",
    params: [{ key: "days", label: "Anticipación (días)", type: "number", default: 14, min: 1 }],
    evaluate: (s, p) =>
      s.projects
        .filter((pr) => pr.target_launch_on && !["launched", "production", "maintenance", "archived", "paused"].includes(pr.status) && pr.target_launch_on <= addDays(s.today, p.days))
        .map((pr) => {
          const late = pr.target_launch_on! < s.today;
          return {
            rule_id: "launch_soon",
            fingerprint: `launch_soon:${pr.id}:${pr.target_launch_on}`,
            project_id: pr.id,
            severity: (late ? "warning" : "info") as Severity,
            title: late ? `${pr.name}: fecha de lanzamiento vencida` : `${pr.name} se lanza el ${pr.target_launch_on}`,
            detail: late ? `La fecha objetivo era ${pr.target_launch_on}.` : `Faltan ${daysBetween(s.today, pr.target_launch_on!)} días.`,
            evidence: { target_launch_on: pr.target_launch_on, status: pr.status },
            link: `/projects/${pr.id}`,
          };
        }),
  },
  {
    id: "budget_overrun",
    name: "Presupuesto excedido",
    description: "Los gastos del mes superan el presupuesto asignado.",
    params: [{ key: "pct", label: "Avisar desde (% del presupuesto)", type: "number", default: 100, min: 1 }],
    evaluate: (s, p) => {
      const month = s.today.slice(0, 7);
      return s.budgets
        .filter((b) => b.month === month && b.amount_minor > 0)
        .flatMap((b) => {
          const txs = s.txs.filter((t) => t.occurred_on.startsWith(month) && (b.project_id === null || t.project_id === b.project_id));
          const sum = summarize(txs)[b.currency];
          const spent = (sum?.operatingExpenses ?? 0) + (sum?.fees ?? 0) + (sum?.investment ?? 0);
          if (spent < (b.amount_minor * p.pct) / 100) return [];
          return [{
            rule_id: "budget_overrun",
            fingerprint: `budget_overrun:${b.project_id ?? "global"}:${month}:${b.currency}`,
            project_id: b.project_id,
            severity: "warning" as Severity,
            title: `Presupuesto ${b.project_id ? "de " + projName(s, b.project_id) : "global"} al ${Math.round((spent / b.amount_minor) * 100)}%`,
            detail: `Gastado ${formatMoney(spent, b.currency)} de ${formatMoney(b.amount_minor, b.currency)} en ${month}.`,
            evidence: { spent_minor: spent, budget_minor: b.amount_minor },
            link: "/finance?tab=budgets",
          }];
        });
    },
  },
];

export interface RuleConfig {
  enabled: boolean;
  params: Record<string, number>;
}

export function defaultParams(rule: RuleDef): Record<string, number> {
  return Object.fromEntries(rule.params.map((p) => [p.key, p.default]));
}

export function evaluateRules(snapshot: AlertSnapshot, configs: Record<string, RuleConfig | undefined>): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const rule of RULES) {
    const cfg = configs[rule.id];
    if (cfg && !cfg.enabled) continue;
    const params = { ...defaultParams(rule), ...(cfg?.params ?? {}) };
    out.push(...rule.evaluate(snapshot, params));
  }
  return out;
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 3, warning: 2, info: 1 };

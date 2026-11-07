/**
 * Financial calculations. All results are per currency (MoneyBag) — currencies are never mixed.
 *
 * Definitions (see docs/FINANCE.md):
 *  grossBilling       = Σ income (cleared + pending)
 *  collected          = Σ income with status cleared
 *  refunds            = Σ refund
 *  fees               = Σ fee (processing commissions)
 *  netRevenue         = grossBilling − refunds
 *  variableCosts      = Σ expense in variable categories (+ fees)
 *  fixedCosts         = Σ expense in fixed categories
 *  operatingExpenses  = Σ expense (all categories)
 *  adSpend            = Σ expense in category "advertising" (included in operatingExpenses)
 *  investment         = Σ investment (capital spent building/launching; NOT an operating expense)
 *  contributionMargin = netRevenue − fees − variableCosts
 *  operatingProfit    = netRevenue − fees − operatingExpenses
 *  cashFlow           = cleared inflows − cleared outflows (income − refunds − fees − expenses − investment)
 *  roi                = (netRevenue − fees − operatingExpenses − investment) / (fees + operatingExpenses + investment)
 */
import { bagCurrencies, type Currency, type MoneyBag } from "./money";
import { isVariable } from "./categories";
import type { DateRange } from "./periods";
import { bucketKey, bucketsIn, inRange, type Bucket } from "./periods";
import type { Transaction } from "./types";

export type TxLike = Pick<Transaction, "kind" | "category" | "amount_minor" | "currency" | "occurred_on" | "status" | "project_id"> & {
  deleted_at?: string | null;
};

export interface Breakdown {
  grossBilling: number;
  collected: number;
  pendingIncome: number;
  refunds: number;
  fees: number;
  netRevenue: number;
  variableCosts: number;
  fixedCosts: number;
  operatingExpenses: number;
  adSpend: number;
  investment: number;
  contributionMargin: number;
  operatingProfit: number;
  cashFlow: number;
  pendingExpenses: number;
  count: number;
}

const empty = (): Breakdown => ({
  grossBilling: 0, collected: 0, pendingIncome: 0, refunds: 0, fees: 0, netRevenue: 0, variableCosts: 0,
  fixedCosts: 0, operatingExpenses: 0, adSpend: 0, investment: 0, contributionMargin: 0, operatingProfit: 0,
  cashFlow: 0, pendingExpenses: 0, count: 0,
});

export type FinanceSummary = Record<Currency, Breakdown>;

export function summarize(txs: TxLike[], range?: DateRange): FinanceSummary {
  const out: FinanceSummary = {};
  for (const t of txs) {
    if (t.deleted_at) continue;
    if (range && !inRange(t.occurred_on, range)) continue;
    const b = (out[t.currency] ??= empty());
    const a = t.amount_minor;
    const cleared = t.status === "cleared";
    b.count++;
    switch (t.kind) {
      case "income":
        b.grossBilling += a;
        if (cleared) {
          b.collected += a;
          b.cashFlow += a;
        } else b.pendingIncome += a;
        break;
      case "refund":
        b.refunds += a;
        if (cleared) b.cashFlow -= a;
        break;
      case "fee":
        b.fees += a;
        if (cleared) b.cashFlow -= a;
        break;
      case "expense":
        b.operatingExpenses += a;
        if (isVariable(t.category)) b.variableCosts += a;
        else b.fixedCosts += a;
        if (t.category === "advertising") b.adSpend += a;
        if (cleared) b.cashFlow -= a;
        else b.pendingExpenses += a;
        break;
      case "investment":
        b.investment += a;
        if (cleared) b.cashFlow -= a;
        break;
    }
  }
  for (const b of Object.values(out)) {
    b.netRevenue = b.grossBilling - b.refunds;
    b.contributionMargin = b.netRevenue - b.fees - b.variableCosts;
    b.operatingProfit = b.netRevenue - b.fees - b.operatingExpenses;
  }
  return out;
}

export function pick(summary: FinanceSummary, field: keyof Breakdown): MoneyBag {
  const bag: MoneyBag = {};
  for (const [cur, b] of Object.entries(summary)) if (b[field]) bag[cur] = b[field];
  return bag;
}

/** ROI as a ratio (0.25 = 25%), or null when there were no outflows to measure against. */
export function roi(b: Breakdown | undefined): number | null {
  if (!b) return null;
  const cost = b.fees + b.operatingExpenses + b.investment;
  if (cost <= 0) return null;
  return (b.netRevenue - cost) / cost;
}

export function margin(b: Breakdown | undefined): number | null {
  if (!b || b.netRevenue <= 0) return null;
  return b.operatingProfit / b.netRevenue;
}

export interface ProjectFinance {
  projectId: string | null;
  summary: FinanceSummary;
}

export function byProject(txs: TxLike[], range?: DateRange): ProjectFinance[] {
  const groups = new Map<string | null, TxLike[]>();
  for (const t of txs) {
    const k = t.project_id ?? null;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  return [...groups.entries()].map(([projectId, list]) => ({ projectId, summary: summarize(list, range) }));
}

export interface SeriesPoint {
  bucket: string;
  income: number;
  expenses: number;
  profit: number;
  investment: number;
}

/** Time series in ONE currency (minor units). */
export function series(txs: TxLike[], range: DateRange, bucket: Bucket, currency: Currency): SeriesPoint[] {
  const keys = bucketsIn(range, bucket);
  const map = new Map(keys.map((k) => [k, { bucket: k, income: 0, expenses: 0, profit: 0, investment: 0 }]));
  for (const t of txs) {
    if (t.deleted_at || t.currency !== currency || !inRange(t.occurred_on, range)) continue;
    const p = map.get(bucketKey(t.occurred_on, bucket));
    if (!p) continue;
    if (t.kind === "income") p.income += t.amount_minor;
    else if (t.kind === "refund") p.income -= t.amount_minor;
    else if (t.kind === "expense" || t.kind === "fee") p.expenses += t.amount_minor;
    else if (t.kind === "investment") p.investment += t.amount_minor;
  }
  for (const p of map.values()) p.profit = p.income - p.expenses;
  return [...map.values()];
}

export interface MonthlyStat {
  month: string;
  netRevenue: number;
  operatingProfit: number;
  cashFlow: number;
  operatingExpenses: number;
}

export function monthly(txs: TxLike[], currency: Currency): MonthlyStat[] {
  const byMonth = new Map<string, TxLike[]>();
  for (const t of txs) {
    if (t.deleted_at || t.currency !== currency) continue;
    const m = t.occurred_on.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(t);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => {
      const b = summarize(list)[currency] ?? empty();
      return { month, netRevenue: b.netRevenue, operatingProfit: b.operatingProfit, cashFlow: b.cashFlow, operatingExpenses: b.operatingExpenses };
    });
}

/**
 * Burn rate: average monthly negative cash flow over the last `months` COMPLETE months.
 * Returns 0 when cash flow was not negative on average, null when there is no data.
 */
export function burnRate(txs: TxLike[], currency: Currency, currentMonth: string, months = 3): number | null {
  const stats = monthly(txs, currency).filter((m) => m.month < currentMonth).slice(-months);
  if (!stats.length) return null;
  const avg = stats.reduce((s, m) => s + m.cashFlow, 0) / stats.length;
  return avg < 0 ? Math.round(-avg) : 0;
}

export interface BreakEven {
  status: "reached" | "projected" | "not_profitable" | "no_data";
  months?: number;
  remaining?: number;
}

/**
 * Break-even of accumulated investment+losses using the average monthly operating profit of the
 * last `months` complete months. This is an ESTIMATE, labelled as such in the UI.
 */
export function breakEven(txs: TxLike[], currency: Currency, currentMonth: string, months = 3): BreakEven {
  const all = summarize(txs)[currency];
  if (!all) return { status: "no_data" };
  const accumulated = all.netRevenue - all.fees - all.operatingExpenses - all.investment;
  if (accumulated >= 0 && all.count > 0) return { status: "reached" };
  const recent = monthly(txs, currency).filter((m) => m.month < currentMonth).slice(-months);
  if (!recent.length) return { status: "no_data" };
  const avgProfit = recent.reduce((s, m) => s + m.operatingProfit, 0) / recent.length;
  if (avgProfit <= 0) return { status: "not_profitable", remaining: -accumulated };
  return { status: "projected", months: Math.ceil(-accumulated / avgProfit), remaining: -accumulated };
}

/** Share of net revenue coming from the top project, per currency (0..1), and its project id. */
export function revenueConcentration(txs: TxLike[], currency: Currency, range?: DateRange): { share: number; projectId: string | null } | null {
  const rows = byProject(txs, range)
    .map((p) => ({ id: p.projectId, rev: p.summary[currency]?.netRevenue ?? 0 }))
    .filter((r) => r.rev > 0);
  const total = rows.reduce((s, r) => s + r.rev, 0);
  if (!total) return null;
  rows.sort((a, b) => b.rev - a.rev);
  return { share: rows[0].rev / total, projectId: rows[0].id };
}

export { bagCurrencies };

/** Monthly-equivalent amount of a recurring cost (minor units). */
export function monthlyEquivalent(amountMinor: number, interval: "weekly" | "monthly" | "quarterly" | "yearly"): number {
  switch (interval) {
    case "weekly":
      return Math.round((amountMinor * 52) / 12);
    case "monthly":
      return amountMinor;
    case "quarterly":
      return Math.round(amountMinor / 3);
    case "yearly":
      return Math.round(amountMinor / 12);
  }
}

export function nextDueDate(from: string, interval: "weekly" | "monthly" | "quarterly" | "yearly"): string {
  const [y, m, d] = from.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (interval === "weekly") date.setDate(date.getDate() + 7);
  else {
    const add = interval === "monthly" ? 1 : interval === "quarterly" ? 3 : 12;
    const target = new Date(y, m - 1 + add, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(d, lastDay));
    return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Scenario simulator. Output is a PROJECTION, never mixed with recorded results. */
export interface ScenarioInput {
  months: number;
  startCustomers: number;
  newCustomersPerMonth: number;
  churnPct: number; // monthly %
  pricePerCustomer: number; // major units / month
  variableCostPct: number; // % of revenue (fees, AI usage...)
  fixedCostsPerMonth: number;
  adSpendPerMonth: number;
  initialInvestment: number;
}

export interface ScenarioRow {
  month: number;
  customers: number;
  revenue: number;
  costs: number;
  profit: number;
  cumulative: number;
}

export function simulate(i: ScenarioInput): { rows: ScenarioRow[]; breakEvenMonth: number | null } {
  const rows: ScenarioRow[] = [];
  let customers = i.startCustomers;
  let cumulative = -i.initialInvestment;
  let breakEvenMonth: number | null = cumulative >= 0 ? 0 : null;
  for (let m = 1; m <= Math.min(Math.max(1, i.months), 120); m++) {
    customers = Math.max(0, customers * (1 - i.churnPct / 100) + i.newCustomersPerMonth);
    const revenue = customers * i.pricePerCustomer;
    const costs = revenue * (i.variableCostPct / 100) + i.fixedCostsPerMonth + i.adSpendPerMonth;
    const profit = revenue - costs;
    cumulative += profit;
    if (breakEvenMonth === null && cumulative >= 0) breakEvenMonth = m;
    rows.push({ month: m, customers: Math.round(customers * 10) / 10, revenue, costs, profit, cumulative });
  }
  return { rows, breakEvenMonth };
}

/** Customer acquisition: CAC and payback from ad spend and new customers (when both are known). */
export function cacPayback(adSpend: number, newCustomers: number, monthlyMarginPerCustomer: number) {
  if (newCustomers <= 0) return { cac: null, paybackMonths: null };
  const cac = adSpend / newCustomers;
  return { cac, paybackMonths: monthlyMarginPerCustomer > 0 ? cac / monthlyMarginPerCustomer : null };
}

import { describe, expect, it } from "vitest";
import { cacPayback, simulate, type ScenarioInput } from "@/domain/scenario";

const base: ScenarioInput = {
  months: 12,
  startCustomers: 0,
  newCustomersPerMonth: 10,
  churnPct: 0,
  pricePerCustomer: 10,
  variableCostPct: 0,
  fixedCostsPerMonth: 50,
  adSpendPerMonth: 0,
  initialInvestment: 100,
};

describe("simulate", () => {
  it("finds the break-even month of the cumulative result", () => {
    const { rows, breakEvenMonth } = simulate(base);
    expect(rows[0]).toMatchObject({ month: 1, customers: 10, revenue: 100, costs: 50, profit: 50, cumulative: -50 });
    expect(rows[1]).toMatchObject({ month: 2, customers: 20, revenue: 200, profit: 150, cumulative: 100 });
    expect(breakEvenMonth).toBe(2);
    expect(rows).toHaveLength(12);
  });

  it("applies churn before adding new customers", () => {
    const { rows } = simulate({ ...base, startCustomers: 100, newCustomersPerMonth: 0, churnPct: 10, months: 3 });
    expect(rows.map((r) => r.customers)).toEqual([90, 81, 72.9]);
  });

  it("includes variable costs and ad spend; null when never profitable", () => {
    const { rows, breakEvenMonth } = simulate({ ...base, variableCostPct: 50, adSpendPerMonth: 1000, months: 6 });
    expect(rows[0].costs).toBe(100 * 0.5 + 50 + 1000);
    expect(breakEvenMonth).toBeNull();
  });

  it("month 0 when there is no investment to recover; clamps months", () => {
    expect(simulate({ ...base, initialInvestment: 0 }).breakEvenMonth).toBe(0);
    expect(simulate({ ...base, months: 0 }).rows).toHaveLength(1);
    expect(simulate({ ...base, months: 999 }).rows).toHaveLength(120);
  });
});

describe("cacPayback", () => {
  it("computes CAC and payback only with known inputs", () => {
    expect(cacPayback(500, 10, 25)).toEqual({ cac: 50, paybackMonths: 2 });
    expect(cacPayback(500, 0, 25)).toEqual({ cac: null, paybackMonths: null });
    expect(cacPayback(500, 10, 0)).toEqual({ cac: 50, paybackMonths: null });
  });
});

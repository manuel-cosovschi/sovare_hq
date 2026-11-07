import { describe, expect, it } from "vitest";
import { breakEven, burnRate, byProject, margin, monthly, monthlyEquivalent, nextDueDate, pick, roi, series, summarize, type TxLike } from "@/domain/finance";

const tx = (p: Partial<TxLike> & Pick<TxLike, "kind" | "amount_minor">): TxLike => ({
  category: "other",
  currency: "USD",
  occurred_on: "2026-10-15",
  status: "cleared",
  project_id: "p1",
  deleted_at: null,
  ...p,
});

describe("summarize", () => {
  it("reference example: income 500, hosting 20, AI 15, ads 100, other 30 → operating profit 335", () => {
    const s = summarize([
      tx({ kind: "income", category: "sales", amount_minor: 50_000 }),
      tx({ kind: "expense", category: "hosting", amount_minor: 2_000 }),
      tx({ kind: "expense", category: "ai", amount_minor: 1_500 }),
      tx({ kind: "expense", category: "advertising", amount_minor: 10_000 }),
      tx({ kind: "expense", category: "other", amount_minor: 3_000 }),
    ]);
    const b = s.USD;
    expect(b.operatingProfit).toBe(33_500);
    expect(b.netRevenue).toBe(50_000);
    expect(b.operatingExpenses).toBe(16_500);
    expect(b.adSpend).toBe(10_000);
    expect(b.variableCosts).toBe(11_500); // ai + advertising
    expect(b.fixedCosts).toBe(5_000); // hosting + other
    expect(b.contributionMargin).toBe(50_000 - 11_500);
    expect(b.cashFlow).toBe(33_500);
    expect(b.count).toBe(5);
    expect(Object.keys(s)).toEqual(["USD"]);
  });

  it("separates cleared vs pending income", () => {
    const b = summarize([
      tx({ kind: "income", amount_minor: 10_000 }),
      tx({ kind: "income", amount_minor: 4_000, status: "pending" }),
    ]).USD;
    expect(b.grossBilling).toBe(14_000);
    expect(b.collected).toBe(10_000);
    expect(b.pendingIncome).toBe(4_000);
    expect(b.cashFlow).toBe(10_000);
    expect(b.netRevenue).toBe(14_000);
  });

  it("refunds reduce net revenue, fees reduce profit, pending expenses are tracked", () => {
    const b = summarize([
      tx({ kind: "income", amount_minor: 10_000 }),
      tx({ kind: "refund", amount_minor: 1_000 }),
      tx({ kind: "fee", category: "payment_processing", amount_minor: 500 }),
      tx({ kind: "expense", category: "tools", amount_minor: 2_000, status: "pending" }),
    ]).USD;
    expect(b.refunds).toBe(1_000);
    expect(b.fees).toBe(500);
    expect(b.netRevenue).toBe(9_000);
    expect(b.operatingProfit).toBe(9_000 - 500 - 2_000);
    expect(b.contributionMargin).toBe(9_000 - 500); // tools are fixed
    expect(b.pendingExpenses).toBe(2_000);
    expect(b.cashFlow).toBe(10_000 - 1_000 - 500); // pending expense not in cash flow
  });

  it("investment is excluded from operating profit but included in cash flow", () => {
    const b = summarize([
      tx({ kind: "income", amount_minor: 10_000 }),
      tx({ kind: "investment", category: "development", amount_minor: 50_000 }),
    ]).USD;
    expect(b.investment).toBe(50_000);
    expect(b.operatingExpenses).toBe(0);
    expect(b.operatingProfit).toBe(10_000);
    expect(b.cashFlow).toBe(-40_000);
  });

  it("ignores deleted rows and rows outside the range", () => {
    const s = summarize(
      [
        tx({ kind: "income", amount_minor: 10_000 }),
        tx({ kind: "income", amount_minor: 99_999, deleted_at: "2026-10-20T00:00:00Z" }),
        tx({ kind: "income", amount_minor: 77_777, occurred_on: "2026-09-01" }),
      ],
      { from: "2026-10-01", to: "2026-10-31" },
    );
    expect(s.USD.grossBilling).toBe(10_000);
    expect(s.USD.count).toBe(1);
  });

  it("never mixes currencies", () => {
    const s = summarize([
      tx({ kind: "income", amount_minor: 10_000, currency: "USD" }),
      tx({ kind: "income", amount_minor: 1_500_000, currency: "ARS" }),
      tx({ kind: "expense", category: "hosting", amount_minor: 200_000, currency: "ARS" }),
    ]);
    expect(s.USD.operatingProfit).toBe(10_000);
    expect(s.ARS.operatingProfit).toBe(1_300_000);
    expect(pick(s, "netRevenue")).toEqual({ USD: 10_000, ARS: 1_500_000 });
    expect(pick(s, "operatingExpenses")).toEqual({ ARS: 200_000 });
  });

  it("byProject groups per project id (including null)", () => {
    const groups = byProject([
      tx({ kind: "income", amount_minor: 100, project_id: "a" }),
      tx({ kind: "income", amount_minor: 200, project_id: "b" }),
      tx({ kind: "expense", amount_minor: 50, project_id: null }),
    ]);
    const m = Object.fromEntries(groups.map((g) => [String(g.projectId), g.summary.USD]));
    expect(m.a.netRevenue).toBe(100);
    expect(m.b.netRevenue).toBe(200);
    expect(m.null.operatingExpenses).toBe(50);
  });
});

describe("ratios", () => {
  it("roi = (net revenue − all outflows) / outflows, null without outflows", () => {
    const b = summarize([
      tx({ kind: "income", amount_minor: 30_000 }),
      tx({ kind: "expense", amount_minor: 5_000 }),
      tx({ kind: "fee", amount_minor: 1_000 }),
      tx({ kind: "investment", amount_minor: 4_000 }),
    ]).USD;
    expect(roi(b)).toBeCloseTo((30_000 - 10_000) / 10_000);
    expect(roi(summarize([tx({ kind: "income", amount_minor: 100 })]).USD)).toBeNull();
    expect(roi(undefined)).toBeNull();
  });

  it("margin is null without revenue", () => {
    expect(margin(summarize([tx({ kind: "expense", amount_minor: 100 })]).USD)).toBeNull();
    expect(margin(summarize([tx({ kind: "income", amount_minor: 1000 }), tx({ kind: "expense", amount_minor: 250 })]).USD)).toBe(0.75);
  });
});

describe("burnRate", () => {
  const txs = [
    tx({ kind: "expense", amount_minor: 10_000, occurred_on: "2026-08-10" }),
    tx({ kind: "expense", amount_minor: 20_000, occurred_on: "2026-09-10" }),
    tx({ kind: "expense", amount_minor: 30_000, occurred_on: "2026-10-10" }),
    tx({ kind: "expense", amount_minor: 999_000, occurred_on: "2026-11-02" }), // current month excluded
  ];

  it("averages negative cash flow of the last complete months", () => {
    expect(burnRate(txs, "USD", "2026-11")).toBe(20_000);
    expect(burnRate(txs, "USD", "2026-11", 1)).toBe(30_000);
  });

  it("is 0 when cash flow is positive and null without data", () => {
    expect(burnRate([tx({ kind: "income", amount_minor: 5_000, occurred_on: "2026-10-01" })], "USD", "2026-11")).toBe(0);
    expect(burnRate(txs, "ARS", "2026-11")).toBeNull();
  });
});

describe("breakEven", () => {
  it("reached when accumulated result is non-negative", () => {
    expect(breakEven([tx({ kind: "income", amount_minor: 1_000 })], "USD", "2026-11")).toEqual({ status: "reached" });
  });

  it("no_data without transactions in that currency", () => {
    expect(breakEven([tx({ kind: "income", amount_minor: 1_000 })], "ARS", "2026-11")).toEqual({ status: "no_data" });
  });

  it("projected from average monthly operating profit", () => {
    const txs = [tx({ kind: "investment", amount_minor: 100_000, occurred_on: "2026-01-10" })];
    for (const m of ["08", "09", "10"]) {
      txs.push(tx({ kind: "income", amount_minor: 15_000, occurred_on: `2026-${m}-05` }));
      txs.push(tx({ kind: "expense", amount_minor: 5_000, occurred_on: `2026-${m}-06` }));
    }
    expect(breakEven(txs, "USD", "2026-11")).toEqual({ status: "projected", months: 7, remaining: 70_000 });
  });

  it("not_profitable when recent months lose money", () => {
    const txs = [
      tx({ kind: "investment", amount_minor: 10_000, occurred_on: "2026-01-10" }),
      tx({ kind: "income", amount_minor: 1_000, occurred_on: "2026-10-05" }),
      tx({ kind: "expense", amount_minor: 3_000, occurred_on: "2026-10-06" }),
    ];
    expect(breakEven(txs, "USD", "2026-11")).toEqual({ status: "not_profitable", remaining: 12_000 });
  });
});

describe("series & monthly", () => {
  it("buckets one currency into the range keys", () => {
    const txs = [
      tx({ kind: "income", amount_minor: 10_000, occurred_on: "2026-02-03" }),
      tx({ kind: "refund", amount_minor: 1_000, occurred_on: "2026-02-04" }),
      tx({ kind: "fee", amount_minor: 300, occurred_on: "2026-02-04" }),
      tx({ kind: "expense", amount_minor: 2_000, occurred_on: "2026-03-10" }),
      tx({ kind: "investment", amount_minor: 5_000, occurred_on: "2026-03-11" }),
      tx({ kind: "income", amount_minor: 1_000_000, occurred_on: "2026-02-03", currency: "ARS" }),
      tx({ kind: "income", amount_minor: 50_000, occurred_on: "2026-02-05", deleted_at: "x" }),
    ];
    const s = series(txs, { from: "2026-01-01", to: "2026-03-31" }, "month", "USD");
    expect(s).toEqual([
      { bucket: "2026-01", income: 0, expenses: 0, profit: 0, investment: 0 },
      { bucket: "2026-02", income: 9_000, expenses: 300, profit: 8_700, investment: 0 },
      { bucket: "2026-03", income: 0, expenses: 2_000, profit: -2_000, investment: 5_000 },
    ]);
  });

  it("monthly is sorted and per currency", () => {
    const m = monthly(
      [
        tx({ kind: "income", amount_minor: 100, occurred_on: "2026-03-01" }),
        tx({ kind: "income", amount_minor: 200, occurred_on: "2026-01-01" }),
        tx({ kind: "income", amount_minor: 300, occurred_on: "2026-01-01", currency: "ARS" }),
      ],
      "USD",
    );
    expect(m.map((x) => [x.month, x.netRevenue])).toEqual([
      ["2026-01", 200],
      ["2026-03", 100],
    ]);
  });
});

describe("recurring helpers", () => {
  it("monthlyEquivalent", () => {
    expect(monthlyEquivalent(1_000, "weekly")).toBe(4_333);
    expect(monthlyEquivalent(1_000, "monthly")).toBe(1_000);
    expect(monthlyEquivalent(3_000, "quarterly")).toBe(1_000);
    expect(monthlyEquivalent(12_000, "yearly")).toBe(1_000);
  });

  it("nextDueDate clamps to month end", () => {
    expect(nextDueDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDueDate("2028-01-31", "monthly")).toBe("2028-02-29");
    expect(nextDueDate("2026-03-31", "monthly")).toBe("2026-04-30");
    expect(nextDueDate("2026-11-30", "quarterly")).toBe("2027-02-28");
    expect(nextDueDate("2028-02-29", "yearly")).toBe("2029-02-28");
    expect(nextDueDate("2026-12-15", "monthly")).toBe("2027-01-15");
    expect(nextDueDate("2026-12-28", "weekly")).toBe("2027-01-04");
  });
});

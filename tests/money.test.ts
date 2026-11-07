import { describe, expect, it } from "vitest";
import { addToBag, convertBag, findRate, fromMinor, parseAmount, toMinor, type RateLike } from "@/domain/money";

describe("parseAmount", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["-45", -45],
    ["(30,00)", -30],
    ["$ 1.500", 1500],
    ["USD 20.5", 20.5],
    ["1.234.567", 1234567],
    ["12,5", 12.5],
    ["1,500", 1500],
    ["+10", 10],
    ["45-", -45],
    ["  0,99 ", 0.99],
  ])("parses %s", (input, expected) => {
    expect(parseAmount(input)).toBeCloseTo(expected, 10);
  });

  it.each(["", "   ", "abc", "1,2,3.4.5x", ".", "--", "1.2.3,4,5"])("returns NaN for invalid input %j", (input) => {
    expect(parseAmount(input)).toBeNaN();
  });

  it("passes numbers through", () => {
    expect(parseAmount(12.3)).toBe(12.3);
  });
});

describe("toMinor / fromMinor", () => {
  it("round-trips 2-decimal currencies", () => {
    expect(toMinor(12.34, "USD")).toBe(1234);
    expect(toMinor(1500.5, "ARS")).toBe(150050);
    expect(fromMinor(1234, "USD")).toBe(12.34);
    expect(fromMinor(toMinor(0.1 + 0.2, "USD"), "USD")).toBe(0.3);
  });

  it("defaults to 2 decimals for unknown currencies", () => {
    expect(toMinor(1, "XYZ")).toBe(100);
  });
});

const rates: RateLike[] = [
  { base: "USD", quote: "ARS", rate: 1000, as_of: "2026-01-01", source: "manual" },
  { base: "USD", quote: "ARS", rate: 1100, as_of: "2026-02-01", source: "dolarapi.com · oficial (venta)" },
  { base: "USD", quote: "ARS", rate: 1200, as_of: "2026-03-01", source: "dolarapi.com · oficial (venta)" },
];

describe("findRate", () => {
  it("picks the latest rate on or before the date", () => {
    expect(findRate(rates, "USD", "ARS", "2026-02-15")).toMatchObject({ rate: 1100, as_of: "2026-02-01", inverted: false });
    expect(findRate(rates, "USD", "ARS", "2026-03-01")?.rate).toBe(1200);
  });

  it("uses the most recent rate when no date is given", () => {
    expect(findRate(rates, "USD", "ARS")?.rate).toBe(1200);
  });

  it("falls back to the oldest rate when the date precedes all rates", () => {
    expect(findRate(rates, "USD", "ARS", "2025-06-01")).toMatchObject({ rate: 1000, as_of: "2026-01-01" });
  });

  it("handles inverse pairs", () => {
    const r = findRate(rates, "ARS", "USD", "2026-02-10");
    expect(r).toMatchObject({ from: "ARS", to: "USD", inverted: true, as_of: "2026-02-01", source: "dolarapi.com · oficial (venta)" });
    expect(r!.rate).toBeCloseTo(1 / 1100, 12);
  });

  it("returns identity for same currency and null when no rate exists", () => {
    expect(findRate([], "USD", "USD")).toMatchObject({ rate: 1, source: "identity" });
    expect(findRate(rates, "EUR", "USD")).toBeNull();
  });
});

describe("convertBag", () => {
  it("converts with explicit rates and reports which were used", () => {
    const bag = { USD: 10_000, ARS: 1_100_000 }; // USD 100 + ARS 11.000
    const out = convertBag(bag, "USD", rates, "2026-02-20");
    expect(out.currency).toBe("USD");
    expect(out.total).toBe(10_000 + 1_000); // ARS 11.000 / 1100 = USD 10
    expect(out.missing).toEqual([]);
    expect(out.ratesUsed).toHaveLength(1);
    expect(out.ratesUsed[0]).toMatchObject({ from: "ARS", to: "USD", as_of: "2026-02-01", source: "dolarapi.com · oficial (venta)", inverted: true });
  });

  it("never mixes currencies without a rate: reports them as missing and excludes them", () => {
    const bag = addToBag(addToBag({}, "USD", 5_000), "EUR", 7_000);
    const out = convertBag(bag, "USD", rates);
    expect(out.total).toBe(5_000);
    expect(out.missing).toEqual(["EUR"]);
    expect(out.ratesUsed).toEqual([]);
  });

  it("ignores zero entries and does not list identity rates", () => {
    const out = convertBag({ USD: 0, ARS: 120_000 }, "ARS", rates);
    expect(out.total).toBe(120_000);
    expect(out.ratesUsed).toEqual([]);
    expect(out.missing).toEqual([]);
  });
});

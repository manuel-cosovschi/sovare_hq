import { describe, expect, it } from "vitest";
import { aggregate, findings, type AdAggregate, type AdDay } from "@/domain/ads";

const day = (p: Partial<AdDay>): AdDay => ({ campaign_id: "c1", date: "2026-11-01", impressions: null, reach: null, clicks: null, spend_minor: null, conversions: null, conversion_value_minor: null, ...p });

describe("aggregate", () => {
  it("computes CTR / CPC / CPM / CPA / ROAS from reported metrics", () => {
    const a = aggregate([
      day({ date: "2026-11-01", impressions: 10_000, reach: 6_000, clicks: 200, spend_minor: 10_000, conversions: 4, conversion_value_minor: 40_000 }),
      day({ date: "2026-11-02", impressions: 10_000, reach: 8_000, clicks: 100, spend_minor: 5_000, conversions: 1, conversion_value_minor: 5_000 }),
    ]);
    expect(a.impressions).toBe(20_000);
    expect(a.clicks).toBe(300);
    expect(a.spend).toBe(15_000);
    expect(a.reach).toBe(8_000); // max, not sum
    expect(a.ctr).toBeCloseTo(1.5);
    expect(a.cpc).toBeCloseTo(50);
    expect(a.cpm).toBeCloseTo(750);
    expect(a.conversions).toBe(5);
    expect(a.cpa).toBeCloseTo(3_000);
    expect(a.roas).toBeCloseTo(3);
    expect(a.days).toBe(2);
  });

  it("returns null (never 0) for missing inputs", () => {
    const a = aggregate([day({ impressions: 1000, clicks: 10, spend_minor: 500 })]);
    expect(a.conversions).toBeNull();
    expect(a.conversionValue).toBeNull();
    expect(a.cpa).toBeNull();
    expect(a.roas).toBeNull();
    expect(a.reach).toBeNull();
    const empty = aggregate([]);
    expect(empty).toMatchObject({ impressions: null, reach: null, clicks: null, spend: null, conversions: null, ctr: null, cpc: null, cpm: null, cpa: null, roas: null, days: 0 });
  });

  it("does not divide by zero: 0 conversions → CPA null but conversions stay 0", () => {
    const a = aggregate([day({ impressions: 0, clicks: 0, spend_minor: 1000, conversions: 0, conversion_value_minor: 0 })]);
    expect(a.conversions).toBe(0);
    expect(a.cpa).toBeNull();
    expect(a.ctr).toBeNull();
    expect(a.cpc).toBeNull();
    expect(a.roas).toBe(0);
  });

  it("partially reported days only sum what was reported and respect the range", () => {
    const rows = [day({ date: "2026-10-31", clicks: 99 }), day({ date: "2026-11-01", clicks: 5 }), day({ date: "2026-11-02", clicks: null })];
    const a = aggregate(rows, { from: "2026-11-01", to: "2026-11-07" });
    expect(a.clicks).toBe(5);
    expect(a.days).toBe(2);
  });
});

const agg = (p: Partial<AdAggregate>): AdAggregate => ({ impressions: 10_000, reach: null, clicks: 100, spend: 10_000, conversions: null, conversionValue: null, ctr: 1, cpc: 100, cpm: 1000, cpa: null, roas: null, days: 7, ...p });

describe("findings", () => {
  const camps = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ];

  it("flags low CTR against the median of at least 3 campaigns", () => {
    const f = findings(camps, { a: agg({ ctr: 2 }), b: agg({ ctr: 2.2 }), c: agg({ ctr: 0.5 }) }, {});
    expect(f.filter((x) => x.kind === "low_ctr").map((x) => x.campaignId)).toEqual(["c"]);
  });

  it("flags no conversions only when conversions are reported as 0 with spend", () => {
    const f = findings(camps, { a: agg({ conversions: 0 }), b: agg({ conversions: null }), c: agg({ conversions: 0, spend: 0 }) }, {});
    expect(f.filter((x) => x.kind === "no_conversions").map((x) => x.campaignId)).toEqual(["a"]);
  });

  it("flags a CTR drop vs the previous period", () => {
    const f = findings([{ id: "a", name: "A" }], { a: agg({ ctr: 0.6 }) }, { a: agg({ ctr: 1.2 }) });
    expect(f.map((x) => x.kind)).toContain("ctr_drop");
    const stable = findings([{ id: "a", name: "A" }], { a: agg({ ctr: 1.0 }) }, { a: agg({ ctr: 1.2 }) });
    expect(stable.map((x) => x.kind)).not.toContain("ctr_drop");
  });

  it("flags spend concentration and CPC rise; nothing without data", () => {
    const f = findings(camps, { a: agg({ spend: 80_000 }), b: agg({ spend: 10_000 }), c: agg({ spend: 10_000 }) }, {});
    expect(f.filter((x) => x.kind === "spend_concentration").map((x) => x.campaignId)).toEqual(["a"]);
    const cpc = findings([{ id: "a", name: "A" }], { a: agg({ cpc: 150 }) }, { a: agg({ cpc: 100 }) });
    expect(cpc.map((x) => x.kind)).toContain("cpc_rise");
    expect(findings(camps, {}, {})).toEqual([]);
  });
});

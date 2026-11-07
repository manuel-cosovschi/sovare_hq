import { describe, expect, it } from "vitest";
import { bucketFor, bucketKey, bucketsIn, inRange, monthRange, pctChange, previousMonthRange, previousRange, rangeFor } from "@/domain/periods";

const TODAY = "2026-11-07";

describe("rangeFor", () => {
  it("computes inclusive presets", () => {
    expect(rangeFor("today", undefined, TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(rangeFor("7d", undefined, TODAY)).toEqual({ from: "2026-11-01", to: TODAY });
    expect(rangeFor("30d", undefined, TODAY)).toEqual({ from: "2026-10-09", to: TODAY });
    expect(rangeFor("90d", undefined, TODAY)).toEqual({ from: "2026-08-10", to: TODAY });
    expect(rangeFor("year", undefined, TODAY)).toEqual({ from: "2026-01-01", to: TODAY });
  });

  it("returns the custom range, or 30d when none given", () => {
    expect(rangeFor("custom", { from: "2026-01-05", to: "2026-02-05" }, TODAY)).toEqual({ from: "2026-01-05", to: "2026-02-05" });
    expect(rangeFor("custom", undefined, TODAY)).toEqual(rangeFor("30d", undefined, TODAY));
  });
});

describe("previousRange", () => {
  it("is the immediately preceding period of equal length", () => {
    expect(previousRange({ from: "2026-11-01", to: "2026-11-07" })).toEqual({ from: "2026-10-25", to: "2026-10-31" });
    expect(previousRange({ from: TODAY, to: TODAY })).toEqual({ from: "2026-11-06", to: "2026-11-06" });
    // crosses a month boundary with 31 days
    expect(previousRange({ from: "2026-03-01", to: "2026-03-31" })).toEqual({ from: "2026-01-29", to: "2026-02-28" });
  });

  it("month helpers", () => {
    expect(monthRange("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(previousMonthRange("2026-03-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("buckets", () => {
  it("week buckets start on Monday", () => {
    expect(bucketKey("2026-11-07", "week")).toBe("2026-11-02"); // Saturday
    expect(bucketKey("2026-11-08", "week")).toBe("2026-11-02"); // Sunday belongs to previous Monday
    expect(bucketKey("2026-11-09", "week")).toBe("2026-11-09"); // Monday
    expect(bucketKey("2027-01-01", "week")).toBe("2026-12-28"); // crosses year
  });

  it("day and month keys", () => {
    expect(bucketKey("2026-11-07T10:00:00Z", "day")).toBe("2026-11-07");
    expect(bucketKey("2026-11-07", "month")).toBe("2026-11");
  });

  it("bucketsIn enumerates unique keys in order", () => {
    expect(bucketsIn({ from: "2026-11-01", to: "2026-11-10" }, "week")).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"]);
    expect(bucketsIn({ from: "2026-01-15", to: "2026-03-02" }, "month")).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("bucketFor picks granularity by length", () => {
    expect(bucketFor({ from: "2026-10-09", to: TODAY })).toBe("day");
    expect(bucketFor({ from: "2026-08-10", to: TODAY })).toBe("week");
    expect(bucketFor({ from: "2026-01-01", to: "2026-12-31" })).toBe("month");
  });

  it("inRange is inclusive and ignores time", () => {
    const r = { from: "2026-11-01", to: "2026-11-07" };
    expect(inRange("2026-11-01", r)).toBe(true);
    expect(inRange("2026-11-07T23:59:59Z", r)).toBe(true);
    expect(inRange("2026-11-08", r)).toBe(false);
  });
});

describe("pctChange", () => {
  it("computes percentage change", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(50, -100)).toBe(150);
  });

  it("is null when previous is 0 or absent", () => {
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(100, null)).toBeNull();
    expect(pctChange(100, undefined)).toBeNull();
  });
});

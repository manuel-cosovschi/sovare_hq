import { addDays, parseDateStr, toDateStr, todayStr, daysBetween } from "@/lib/util";

export type RangePreset = "today" | "7d" | "30d" | "90d" | "year" | "custom";
export const RANGE_LABEL: Record<RangePreset, string> = {
  today: "Hoy", "7d": "7 días", "30d": "30 días", "90d": "90 días", year: "Año", custom: "Personalizado",
};

export interface DateRange {
  from: string; // inclusive YYYY-MM-DD
  to: string; // inclusive YYYY-MM-DD
}

export function rangeFor(preset: RangePreset, custom?: DateRange, today = todayStr()): DateRange {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "custom":
      return custom ?? { from: addDays(today, -29), to: today };
  }
}

/** The immediately preceding period of the same length. */
export function previousRange(r: DateRange): DateRange {
  const len = daysBetween(r.from, r.to) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

export function monthRange(today = todayStr()): DateRange {
  const d = parseDateStr(today);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: `${today.slice(0, 7)}-01`, to: toDateStr(last) };
}

export function previousMonthRange(today = todayStr()): DateRange {
  const d = parseDateStr(today);
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const last = new Date(d.getFullYear(), d.getMonth(), 0);
  return { from: toDateStr(first), to: toDateStr(last) };
}

export type Bucket = "day" | "week" | "month";
export function bucketFor(r: DateRange): Bucket {
  const len = daysBetween(r.from, r.to) + 1;
  return len <= 45 ? "day" : len <= 200 ? "week" : "month";
}

export function bucketKey(date: string, b: Bucket): string {
  if (b === "day") return date.slice(0, 10);
  if (b === "month") return date.slice(0, 7);
  const d = parseDateStr(date);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return toDateStr(d);
}

export function bucketsIn(r: DateRange, b: Bucket): string[] {
  const out: string[] = [];
  let cur = r.from;
  const seen = new Set<string>();
  while (cur <= r.to) {
    const k = bucketKey(cur, b);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
    cur = addDays(cur, 1);
  }
  return out;
}

export const inRange = (date: string, r: DateRange) => date.slice(0, 10) >= r.from && date.slice(0, 10) <= r.to;

/** Percentage change, or null when the previous value is 0/absent (not computable). */
export function pctChange(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

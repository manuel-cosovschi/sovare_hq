import * as React from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/domain/money";
import type { Bucket } from "@/domain/periods";

export const SERIES = {
  income: { label: "Ingresos netos", color: "var(--chart-1)" },
  expenses: { label: "Gastos + comisiones", color: "var(--chart-2)" },
  profit: { label: "Beneficio operativo", color: "var(--chart-3)" },
  investment: { label: "Inversión", color: "var(--chart-4)" },
} as const;
export type SeriesKey = keyof typeof SERIES;

const tickLabel = (b: Bucket) => (v: string) => (b === "month" ? fmtDate(v + "-01", "MMM yy") : fmtDate(v, "d MMM"));

function TooltipBox({ active, payload, label, currency, bucket }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: string; currency: string; bucket: Bucket }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-[var(--shadow-md)]">
      <p className="mb-1 font-medium text-ink">{label ? (bucket === "week" ? `Semana del ${fmtDate(label, "d MMM")}` : tickLabel(bucket)(label)) : ""}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center justify-between gap-4 text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-sm" style={{ background: p.color }} />
            {SERIES[p.dataKey as SeriesKey]?.label ?? p.dataKey}
          </span>
          <span className="tabular font-medium text-ink">{formatMoney(p.value, currency)}</span>
        </p>
      ))}
    </div>
  );
}

export function FinanceChart({ data, series, currency, bucket, height = 260, kind = "area" }: { data: ReadonlyArray<object>; series: SeriesKey[]; currency: string; bucket: Bucket; height?: number; kind?: "area" | "bar" }) {
  const axis = { stroke: "var(--ink-3)", fontSize: 11, tickLine: false, axisLine: false } as const;
  const yFmt = (v: number) => formatMoney(v, currency, { compact: true }).replace(currency + " ", "");
  const common = (
    <>
      <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
      <XAxis dataKey="bucket" tickFormatter={tickLabel(bucket)} {...axis} minTickGap={24} />
      <YAxis tickFormatter={yFmt} {...axis} width={54} />
      <Tooltip content={<TooltipBox currency={currency} bucket={bucket} />} cursor={{ stroke: "var(--line-strong)", fill: "var(--surface-2)" }} />
      {series.length > 1 && <Legend iconType="circle" iconSize={8} formatter={(v: string) => <span className="text-[11.5px] text-ink-2">{SERIES[v as SeriesKey]?.label ?? v}</span>} />}
    </>
  );
  return (
    <div style={{ height }} role="img" aria-label={`Gráfico financiero en ${currency}`}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart data={data as object[]} barGap={2} barCategoryGap="22%">
            {common}
            {series.map((s) => (
              <Bar key={s} dataKey={s} fill={SERIES[s].color} radius={[4, 4, 0, 0]} maxBarSize={22} />
            ))}
          </BarChart>
        ) : (
          <AreaChart data={data as object[]}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s} id={`g-${s}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES[s].color} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={SERIES[s].color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            {common}
            {series.map((s) => (
              <Area key={s} type="monotone" dataKey={s} stroke={SERIES[s].color} strokeWidth={2} fill={`url(#g-${s})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
            ))}
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({ values, color = "var(--chart-1)", height = 28 }: { values: number[]; color?: string; height?: number }) {
  const data = React.useMemo(() => values.map((v, i) => ({ i, v })), [values]);
  if (values.length < 2) return null;
  return (
    <div style={{ height, width: "100%" }} aria-hidden>
      <ResponsiveContainer>
        <AreaChart data={data as object[]} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.08} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

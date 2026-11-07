/**
 * Advertising metrics. Derived ratios are computed ONLY from metrics actually reported by the
 * platform; missing inputs yield null ("Sin datos"), never zero or an invented value.
 */
import type { DateRange } from "./periods";
import { inRange } from "./periods";

export interface AdDay {
  campaign_id: string;
  date: string;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  spend_minor: number | null;
  conversions: number | null;
  conversion_value_minor: number | null;
}

export interface AdAggregate {
  impressions: number | null;
  reach: number | null; // max daily reach (reach is not additive across days)
  clicks: number | null;
  spend: number | null; // minor units
  conversions: number | null;
  conversionValue: number | null;
  ctr: number | null; // %
  cpc: number | null; // minor
  cpm: number | null; // minor
  cpa: number | null; // minor
  roas: number | null; // ratio
  days: number;
}

const sumNullable = (vals: Array<number | null>): number | null => {
  const present = vals.filter((v): v is number => v !== null && v !== undefined);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
};

export function aggregate(rows: AdDay[], range?: DateRange): AdAggregate {
  const r = range ? rows.filter((x) => inRange(x.date, range)) : rows;
  const impressions = sumNullable(r.map((x) => x.impressions));
  const clicks = sumNullable(r.map((x) => x.clicks));
  const spend = sumNullable(r.map((x) => x.spend_minor));
  const conversions = sumNullable(r.map((x) => x.conversions));
  const conversionValue = sumNullable(r.map((x) => x.conversion_value_minor));
  const reachVals = r.map((x) => x.reach).filter((v): v is number => v !== null);
  return {
    impressions,
    reach: reachVals.length ? Math.max(...reachVals) : null,
    clicks,
    spend,
    conversions,
    conversionValue,
    ctr: impressions && clicks !== null ? (clicks / impressions) * 100 : null,
    cpc: clicks && spend !== null ? spend / clicks : null,
    cpm: impressions && spend !== null ? (spend / impressions) * 1000 : null,
    cpa: conversions && spend !== null ? spend / conversions : null,
    roas: spend && conversionValue !== null ? conversionValue / spend : null,
    days: new Set(r.map((x) => x.date)).size,
  };
}

export interface AdFinding {
  campaignId: string;
  kind: "low_ctr" | "high_cpa" | "no_conversions" | "spend_concentration" | "ctr_drop" | "cpc_rise";
  message: string;
  basis: string;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Evidence-based findings comparing campaigns among themselves and against the previous period. */
export function findings(
  campaigns: Array<{ id: string; name: string }>,
  current: Record<string, AdAggregate>,
  previous: Record<string, AdAggregate>,
): AdFinding[] {
  const out: AdFinding[] = [];
  const ctrs = campaigns.map((c) => current[c.id]?.ctr).filter((v): v is number => v !== null && v !== undefined);
  const cpas = campaigns.map((c) => current[c.id]?.cpa).filter((v): v is number => v !== null && v !== undefined);
  const medCtr = median(ctrs);
  const medCpa = median(cpas);
  const totalSpend = campaigns.reduce((s, c) => s + (current[c.id]?.spend ?? 0), 0);
  for (const c of campaigns) {
    const a = current[c.id];
    if (!a) continue;
    if (medCtr !== null && ctrs.length >= 3 && a.ctr !== null && (a.impressions ?? 0) >= 1000 && a.ctr < medCtr * 0.5)
      out.push({ campaignId: c.id, kind: "low_ctr", message: `CTR de "${c.name}" (${a.ctr.toFixed(2)}%) está por debajo de la mitad de la mediana (${medCtr.toFixed(2)}%).`, basis: "CTR reportado vs mediana de tus campañas del período" });
    if (medCpa !== null && cpas.length >= 3 && a.cpa !== null && a.cpa > medCpa * 1.5)
      out.push({ campaignId: c.id, kind: "high_cpa", message: `CPA de "${c.name}" es ${(a.cpa / medCpa).toFixed(1)}× la mediana.`, basis: "CPA = gasto / conversiones reportadas" });
    if (a.conversions === 0 && (a.spend ?? 0) > 0)
      out.push({ campaignId: c.id, kind: "no_conversions", message: `"${c.name}" registró gasto y 0 conversiones reportadas.`, basis: "Conversiones reportadas por la plataforma = 0" });
    if (totalSpend > 0 && campaigns.length >= 3 && (a.spend ?? 0) / totalSpend > 0.6)
      out.push({ campaignId: c.id, kind: "spend_concentration", message: `"${c.name}" concentra el ${Math.round(((a.spend ?? 0) / totalSpend) * 100)}% del gasto.`, basis: "Participación en el gasto total del período" });
    const p = previous[c.id];
    if (p?.ctr && a.ctr !== null && (a.impressions ?? 0) >= 1000 && a.ctr < p.ctr * 0.7)
      out.push({ campaignId: c.id, kind: "ctr_drop", message: `CTR de "${c.name}" cayó de ${p.ctr.toFixed(2)}% a ${a.ctr.toFixed(2)}%.`, basis: "Comparación con el período anterior de igual duración" });
    if (p?.cpc && a.cpc !== null && a.cpc > p.cpc * 1.4)
      out.push({ campaignId: c.id, kind: "cpc_rise", message: `CPC de "${c.name}" subió ${Math.round((a.cpc / p.cpc - 1) * 100)}%.`, basis: "Comparación con el período anterior de igual duración" });
  }
  return out;
}

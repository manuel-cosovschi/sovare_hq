import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileUp, Megaphone, Sparkles, AlertTriangle, Info, Plug } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, NoData, PageHeader, Segmented, Select, Skeleton, Tip } from "@/components/ui/primitives";
import { Delta } from "@/components/common";
import { useAction, useData } from "@/app/hooks";
import { useProjects } from "@/app/queries";
import { listAdMetrics, listCampaigns, setCampaignProject, upsertCampaigns, upsertAdMetrics } from "@/repos/marketing";
import { aggregate, findings, type AdAggregate } from "@/domain/ads";
import { previousRange, rangeFor, RANGE_LABEL, pctChange, type RangePreset, bucketsIn } from "@/domain/periods";
import { formatMoney, parseAmount, toMinor } from "@/domain/money";
import { parseCsv, parseDate } from "@/domain/csvImport";
import { pickTextFile } from "@/platform/files";
import { fmtDate, fmtNum, fmtPct, relTime } from "@/lib/format";
import { cx } from "@/lib/util";
import { useToast } from "@/components/ui/feedback";

export default function MarketingPage() {
  const nav = useNavigate();
  const projects = useProjects();
  const toast = useToast();
  const [preset, setPreset] = React.useState<RangePreset>("30d");
  const [projectId, setProjectId] = React.useState("");
  const [platform, setPlatform] = React.useState("");
  const [onlyActive, setOnlyActive] = React.useState(false);
  const range = rangeFor(preset === "custom" ? "30d" : preset);
  const prev = previousRange(range);
  const camps = useData(["campaigns"], listCampaigns);
  const metrics = useData(["ad_metrics", prev.from, range.to], () => listAdMetrics(prev.from, range.to));
  const assign = useAction((id: string, pid: string | null) => setCampaignProject(id, pid), { success: "Campaña asociada" });

  const list = (camps.data ?? []).filter((c) => c.level === "campaign" && (!projectId || c.project_id === projectId) && (!platform || c.platform === platform) && (!onlyActive || /active/i.test(c.status)));
  const cur: Record<string, AdAggregate> = {};
  const old: Record<string, AdAggregate> = {};
  for (const c of list) {
    const rows = (metrics.data ?? []).filter((m) => m.campaign_id === c.id);
    cur[c.id] = aggregate(rows, range);
    old[c.id] = aggregate(rows, prev);
  }
  const f = findings(list, cur, old);
  const platforms = [...new Set((camps.data ?? []).map((c) => c.platform))];
  const byCurrency = new Map<string, { spend: number; prevSpend: number; clicks: number; impressions: number; conv: number | null }>();
  for (const c of list) {
    const k = c.currency ?? "USD";
    const e = byCurrency.get(k) ?? { spend: 0, prevSpend: 0, clicks: 0, impressions: 0, conv: null };
    e.spend += cur[c.id].spend ?? 0;
    e.prevSpend += old[c.id].spend ?? 0;
    e.clicks += cur[c.id].clicks ?? 0;
    e.impressions += cur[c.id].impressions ?? 0;
    if (cur[c.id].conversions !== null) e.conv = (e.conv ?? 0) + cur[c.id].conversions!;
    byCurrency.set(k, e);
  }
  const days = bucketsIn(range, "day");
  const daily = days.map((d) => {
    const row: Record<string, number | string> = { bucket: d };
    for (const [c] of byCurrency) row[c] = (metrics.data ?? []).filter((m) => m.date === d && list.some((x) => x.id === m.campaign_id && (x.currency ?? "USD") === c)).reduce((s, m) => s + (m.spend_minor ?? 0), 0);
    return row;
  });

  const importCsv = async () => {
    const file = await pickTextFile(["csv"]);
    if (!file) return;
    try {
      const { rows, headers } = parseCsv(file.content);
      const col = (...names: string[]) => headers.find((h) => names.includes(h.toLowerCase().trim()));
      const cDate = col("date", "day", "fecha", "día");
      const cName = col("campaign", "campaña", "campaign name");
      if (!cDate || !cName) throw new Error("El CSV necesita columnas de fecha y campaña");
      const cImp = col("impressions", "impr.", "impresiones");
      const cClk = col("clicks", "clics");
      const cCost = col("cost", "spend", "costo", "gasto", "importe gastado");
      const cConv = col("conversions", "conversiones", "conv.");
      const cVal = col("conv. value", "conversion value", "valor de conv.");
      const cCur = col("currency", "moneda", "currency code");
      const cPlat = col("platform", "plataforma");
      const names = [...new Set(rows.map((r) => r[cName]).filter(Boolean))];
      const plat = (r: Record<string, string>) => (cPlat && r[cPlat]) || "google_ads";
      const idMap = await upsertCampaigns(names.map((n) => {
        const r = rows.find((x) => x[cName] === n)!;
        return { platform: plat(r), account_id: null, external_id: `csv:${n}`, level: "campaign" as const, parent_external_id: null, project_id: projectId || null, name: n, objective: null, status: "UNKNOWN (CSV)", daily_budget_minor: null, lifetime_budget_minor: null, currency: (cCur && r[cCur]?.toUpperCase()) || "USD", start_on: null, end_on: null, source: "csv" };
      }));
      const num = (r: Record<string, string>, c?: string) => (c && r[c] !== undefined && r[c] !== "" ? parseAmount(r[c]) : null);
      const out = rows.flatMap((r) => {
        const date = parseDate(r[cDate]);
        const cid = idMap[`csv:${r[cName]}`];
        if (!date || !cid) return [];
        const cur = (cCur && r[cCur]?.toUpperCase()) || "USD";
        const cost = num(r, cCost);
        const val = num(r, cVal);
        return [{ campaign_id: cid, date, impressions: num(r, cImp), reach: null, clicks: num(r, cClk), spend_minor: cost === null ? null : toMinor(cost, cur), currency: cur, conversions: num(r, cConv), conversion_value_minor: val === null ? null : toMinor(val, cur), conversion_label: cConv ? "csv" : null, source: "csv" }];
      });
      await upsertAdMetrics(out);
      toast.show({ title: `${out.length} filas importadas de ${names.length} campañas`, tone: "success" });
      void camps.refetch();
      void metrics.refetch();
    } catch (e) {
      toast.show({ title: "No se pudo importar", body: (e as Error).message, tone: "danger" });
    }
  };

  return (
    <div>
      <PageHeader
        title="Marketing"
        subtitle="Ads Control Center · modo lectura: Sovare HQ nunca pausa campañas ni modifica presupuestos"
        actions={
          <>
            <Button icon={<FileUp className="size-4" />} onClick={() => void importCsv()}>Importar CSV</Button>
            <Button icon={<Plug className="size-4" />} onClick={() => nav("/integrations?open=meta_ads")}>Meta Ads</Button>
          </>
        }
      />
      {camps.isLoading ? <Skeleton className="h-96" /> : !(camps.data ?? []).length ? (
        <Card>
          <EmptyState icon={<Megaphone />} title="Publicidad: No conectada" body="Conectá Meta Ads (lectura) o importá un CSV exportado de Google Ads / Meta con columnas fecha, campaña, impresiones, clics, costo y conversiones. No se muestran métricas inventadas." action={<Button variant="primary" onClick={() => nav("/integrations?open=meta_ads")}>Conectar Meta Ads</Button>} />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={preset} onChange={setPreset} options={(["7d", "30d", "90d", "year"] as RangePreset[]).map((p) => ({ value: p, label: RANGE_LABEL[p] }))} />
            <Select className="w-48" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Proyecto"><option value="">Todos los proyectos</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            <Select className="w-40" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Plataforma"><option value="">Todas las plataformas</option>{platforms.map((p) => <option key={p} value={p}>{p}</option>)}</Select>
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />Solo activas</label>
            <span className="ml-auto text-[12px] text-ink-3">vs {fmtDate(prev.from)} – {fmtDate(prev.to)}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[...byCurrency.entries()].map(([c, e]) => (
              <React.Fragment key={c}>
                <Card className="p-3.5"><p className="text-[11.5px] font-medium text-ink-3">Gasto · {c}</p><p className="mt-1 text-[19px] font-semibold tabular">{formatMoney(e.spend, c)}</p><Delta inverse value={pctChange(e.spend, e.prevSpend)} /></Card>
                <Card className="p-3.5"><p className="text-[11.5px] font-medium text-ink-3">CTR medio · {c}</p><p className="mt-1 text-[19px] font-semibold tabular">{e.impressions ? fmtPct((e.clicks / e.impressions) * 100, 2) : <NoData />}</p><p className="text-[11px] text-ink-3">{fmtNum(e.clicks)} clics / {fmtNum(e.impressions)} impresiones</p></Card>
                <Card className="p-3.5"><p className="text-[11.5px] font-medium text-ink-3">Conversiones · {c}</p><p className="mt-1 text-[19px] font-semibold tabular">{e.conv === null ? <NoData /> : fmtNum(e.conv)}</p><p className="text-[11px] text-ink-3">{e.conv === null ? "La plataforma no reporta conversiones configuradas" : "Reportadas por la plataforma"}</p></Card>
                <Card className="p-3.5"><p className="text-[11.5px] font-medium text-ink-3">CPA · {c}</p><p className="mt-1 text-[19px] font-semibold tabular">{e.conv ? formatMoney(Math.round(e.spend / e.conv), c) : <NoData />}</p><p className="text-[11px] text-ink-3">Gasto / conversiones</p></Card>
              </React.Fragment>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader title="Gasto diario" subtitle="Una serie por moneda (no se suman monedas distintas)" />
              <div className="h-56 px-2 pb-3">
                <ResponsiveContainer>
                  <BarChart data={daily}>
                    <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="bucket" tickFormatter={(v: string) => fmtDate(v, "d MMM")} stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={false} width={50} tickFormatter={(v: number) => fmtNum(v / 100)} />
                    <Tooltip cursor={{ fill: "var(--surface-2)" }} contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }} labelFormatter={(l) => fmtDate(String(l))} formatter={(v, n) => [formatMoney(Number(v), String(n)), `Gasto ${n}`]} />
                    {[...byCurrency.keys()].map((c, i) => <Bar key={c} dataKey={c} fill={i === 0 ? "var(--chart-2)" : "var(--chart-3)"} radius={[4, 4, 0, 0]} maxBarSize={18} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <CardHeader title="Ads AI Analyst" icon={<Sparkles className="size-4 text-accent" />} subtitle="Análisis local basado en evidencia (sin enviar datos a terceros)" />
              <div className="space-y-2 px-4 pb-4">
                {f.length ? f.slice(0, 6).map((x, i) => (
                  <div key={i} className="rounded-lg border border-line p-2.5">
                    <p className="flex items-start gap-1.5 text-[12.5px] font-medium"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />{x.message}</p>
                    <p className="mt-0.5 pl-5 text-[11.5px] text-ink-3">Fundamento: {x.basis}</p>
                  </div>
                )) : <p className="text-[12.5px] text-ink-3">Sin hallazgos relevantes en el período.</p>}
                <div className="rounded-lg bg-surface-2 p-2.5 text-[11.5px] text-ink-3">
                  <p className="mb-0.5 flex items-center gap-1 font-medium text-ink-2"><Info className="size-3.5" />Limitaciones</p>
                  Solo se usan métricas reportadas por cada plataforma. ROAS se calcula únicamente si la plataforma informa valor de conversión. No se atribuyen ventas registradas en Finance a campañas.
                </div>
              </div>
            </Card>
          </div>
          <Card className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>Campaña</th><th>Proyecto</th><th>Estado</th><th className="text-right">Presupuesto</th><th className="text-right">Gasto</th><th className="text-right">Impr.</th><th className="text-right">Alcance</th><th className="text-right">Clics</th><th className="text-right">CTR</th><th className="text-right">CPC</th><th className="text-right">CPM</th><th className="text-right">Conv.</th><th className="text-right">CPA</th><th className="text-right">ROAS</th></tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const a = cur[c.id];
                  const o = old[c.id];
                  const cc = c.currency ?? "USD";
                  const nd = <span className="text-[11.5px] text-ink-3">—</span>;
                  const flagged = f.some((x) => x.campaignId === c.id);
                  return (
                    <tr key={c.id}>
                      <td>
                        <p className={cx("max-w-60 truncate font-medium", flagged && "text-warning")}>{c.name}</p>
                        <p className="text-[11px] text-ink-3">{c.platform} · {c.objective ?? "—"} · sync {relTime(c.synced_at)}</p>
                      </td>
                      <td>
                        <Select className="w-36" value={c.project_id ?? ""} onChange={(e) => void assign.run(c.id, e.target.value || null)} aria-label="Proyecto asociado">
                          <option value="">—</option>
                          {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </Select>
                      </td>
                      <td><Badge tone={/active/i.test(c.status) ? "success" : "neutral"}>{c.status}</Badge></td>
                      <td className="text-right tabular">{c.daily_budget_minor ? `${formatMoney(c.daily_budget_minor, cc)}/d` : c.lifetime_budget_minor ? formatMoney(c.lifetime_budget_minor, cc) : nd}</td>
                      <td className="text-right tabular">{a.spend === null ? nd : <><div>{formatMoney(a.spend, cc)}</div><Delta inverse value={o.spend === null ? null : pctChange(a.spend, o.spend)} /></>}</td>
                      <td className="text-right tabular">{a.impressions === null ? nd : fmtNum(a.impressions)}</td>
                      <td className="text-right tabular"><Tip content="Máximo diario: el alcance no es sumable entre días">{<span>{a.reach === null ? "—" : fmtNum(a.reach)}</span>}</Tip></td>
                      <td className="text-right tabular">{a.clicks === null ? nd : fmtNum(a.clicks)}</td>
                      <td className="text-right tabular">{a.ctr === null ? nd : fmtPct(a.ctr, 2)}</td>
                      <td className="text-right tabular">{a.cpc === null ? nd : formatMoney(Math.round(a.cpc), cc)}</td>
                      <td className="text-right tabular">{a.cpm === null ? nd : formatMoney(Math.round(a.cpm), cc)}</td>
                      <td className="text-right tabular">{a.conversions === null ? <Tip content="La plataforma no reporta conversiones para esta campaña (o no configuraste la acción de conversión)"><span className="text-[11.5px] text-ink-3">Sin datos</span></Tip> : fmtNum(a.conversions)}</td>
                      <td className="text-right tabular">{a.cpa === null ? nd : formatMoney(Math.round(a.cpa), cc)}</td>
                      <td className="text-right tabular">{a.roas === null ? nd : `${a.roas.toFixed(2)}×`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!list.length && <EmptyState compact title="Ninguna campaña coincide con los filtros" />}
          </Card>
          <p className="text-[11.5px] text-ink-3">Acciones sobre campañas (pausar, cambiar presupuesto) están deshabilitadas por diseño. La arquitectura prevé acciones futuras con aprobación explícita.</p>
        </div>
      )}
    </div>
  );
}

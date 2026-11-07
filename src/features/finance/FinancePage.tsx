import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Download, FileUp, Plus, Search, Paperclip, MoreHorizontal, History } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Input, InfoTip, Menu, PageHeader, Segmented, Select, Skeleton, Tabs, Sheet } from "@/components/ui/primitives";
import { ProjectAvatar, Stat } from "@/components/common";
import { useApp } from "@/app/AppContext";
import { useAction, useData } from "@/app/hooks";
import { useProjects } from "@/app/queries";
import { listTransactions, deleteTransaction, restoreTransaction, getTransaction } from "@/repos/finance";
import { auditTrail } from "@/repos/core";
import { summarize, byProject, roi, margin, series as buildSeries, type Breakdown } from "@/domain/finance";
import { bucketFor, previousRange, rangeFor, RANGE_LABEL, pctChange, type DateRange, type RangePreset } from "@/domain/periods";
import { formatMoney } from "@/domain/money";
import { categoryLabel } from "@/domain/categories";
import { TX_KIND_LABEL, type Transaction, type TxKind } from "@/domain/types";
import { toCsv } from "@/domain/csvImport";
import { saveFile, openAttachment } from "@/platform/files";
import { FinanceChart } from "@/components/charts/FinanceChart";
import { Delta } from "@/components/common";
import { ConvertedTotal } from "@/components/Converted";
import { fmtDate, fmtPct, relTime } from "@/lib/format";
import { addDays, cx, todayStr, parseJson } from "@/lib/util";
import { TransactionDialog } from "./TransactionDialog";
import { CsvImportDialog } from "./CsvImportDialog";
import { RecurringTab, BudgetsTab, IntelligenceTab, SimulatorTab, RatesTab } from "./FinanceTabs";
import { useToast } from "@/components/ui/feedback";

type Tab = "overview" | "transactions" | "recurring" | "budgets" | "intelligence" | "simulator" | "rates";

export default function FinancePage() {
  const [params, setParams] = useSearchParams();
  const app = useApp();
  const tab = (params.get("tab") as Tab) ?? (params.get("tx") || params.get("kind") ? "transactions" : "overview");
  const setTab = (t: Tab) => setParams({ tab: t });
  return (
    <div>
      <PageHeader
        title="Finance"
        subtitle="Importes en su moneda original · ingresos ≠ ganancia · la inversión se informa aparte"
        actions={
          <>
            <Button icon={<FileUp className="size-4" />} onClick={() => setParams({ tab: "transactions", import: "1" })}>Importar CSV</Button>
            <Button onClick={() => app.openQuick("expense")} icon={<Plus className="size-4" />}>Gasto</Button>
            <Button variant="primary" onClick={() => app.openQuick("income")} icon={<Plus className="size-4" />}>Ingreso</Button>
          </>
        }
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "overview", label: "Resumen" }, { value: "transactions", label: "Transacciones" }, { value: "recurring", label: "Recurrentes y suscripciones" }, { value: "budgets", label: "Presupuestos" }, { value: "intelligence", label: "Financial Intelligence" }, { value: "simulator", label: "Simulador" }, { value: "rates", label: "Tipos de cambio" }]} />
      {tab === "overview" && <OverviewTab />}
      {tab === "transactions" && <TransactionsTab />}
      {tab === "recurring" && <RecurringTab />}
      {tab === "budgets" && <BudgetsTab />}
      {tab === "intelligence" && <IntelligenceTab />}
      {tab === "simulator" && <SimulatorTab />}
      {tab === "rates" && <RatesTab />}
      <CsvImportDialog open={params.get("import") === "1"} onClose={() => setParams({ tab: "transactions" })} />
    </div>
  );
}

const ROWS: Array<{ key: keyof Breakdown; label: string; hint: string; inverse?: boolean }> = [
  { key: "grossBilling", label: "Facturación bruta", hint: "Todos los ingresos registrados (cobrados + pendientes)" },
  { key: "collected", label: "Cobrado", hint: "Ingresos con estado cobrado" },
  { key: "refunds", label: "Reembolsos", hint: "Devoluciones y contracargos", inverse: true },
  { key: "fees", label: "Comisiones de procesamiento", hint: "Stripe, Mercado Pago, etc.", inverse: true },
  { key: "variableCosts", label: "Costos variables", hint: "Categorías variables: IA, publicidad, contratistas, mercadería…", inverse: true },
  { key: "fixedCosts", label: "Gastos fijos", hint: "Hosting, herramientas, dominios, impuestos…", inverse: true },
  { key: "adSpend", label: "Inversión publicitaria", hint: "Gastos en la categoría Publicidad (incluidos en costos)", inverse: true },
  { key: "investment", label: "Inversión (desarrollo / lanzamiento)", hint: "Capital invertido; no es gasto operativo", inverse: true },
  { key: "contributionMargin", label: "Margen de contribución", hint: "Ingresos netos − comisiones − costos variables" },
  { key: "operatingProfit", label: "Beneficio operativo", hint: "Ingresos netos − comisiones − gastos operativos" },
  { key: "cashFlow", label: "Flujo de caja", hint: "Movimientos cobrados/pagados: entradas − salidas (incluye inversión)" },
];

function OverviewTab() {
  const projects = useProjects();
  const [preset, setPreset] = React.useState<RangePreset>("30d");
  const [custom, setCustom] = React.useState<DateRange>({ from: addDays(todayStr(), -30), to: todayStr() });
  const range = rangeFor(preset, custom);
  const prev = previousRange(range);
  const txs = useData(["transactions", "from", prev.from], () => listTransactions({ from: prev.from }));
  const cur = summarize(txs.data ?? [], range);
  const old = summarize(txs.data ?? [], prev);
  const currencies = Object.keys({ ...cur, ...old });
  const [chartCur, setChartCur] = React.useState<string | null>(null);
  const cc = chartCur && currencies.includes(chartCur) ? chartCur : currencies[0];
  const proj = byProject(txs.data ?? [], range);
  if (txs.isLoading) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={preset} onChange={setPreset} options={(Object.keys(RANGE_LABEL) as RangePreset[]).map((p) => ({ value: p, label: RANGE_LABEL[p] }))} />
        {preset === "custom" && (
          <>
            <Input type="date" className="w-36" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="Desde" />
            <Input type="date" className="w-36" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="Hasta" />
          </>
        )}
        <span className="text-[12px] text-ink-3">{fmtDate(range.from)} → {fmtDate(range.to)} · comparado con {fmtDate(prev.from)} → {fmtDate(prev.to)}</span>
      </div>
      {!currencies.length ? (
        <Card><EmptyState icon={<Plus />} title="Sin movimientos en el período" body="Registrá ingresos y gastos o importá un CSV. Nunca se muestran cifras simuladas en modo normal." /></Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {currencies.map((c) => (
              <React.Fragment key={c}>
                <Stat label={`Ingresos netos · ${c}`} value={formatMoney(cur[c]?.netRevenue ?? 0, c)} sub={<Delta value={pctChange(cur[c]?.netRevenue ?? 0, old[c]?.netRevenue)} />} />
                <Stat label={`Beneficio operativo · ${c}`} value={<span className={cx((cur[c]?.operatingProfit ?? 0) < 0 && "text-danger")}>{formatMoney(cur[c]?.operatingProfit ?? 0, c)}</span>} sub={margin(cur[c]) !== null ? `Margen ${fmtPct(margin(cur[c])! * 100, 0)}` : "Margen: sin ingresos"} />
              </React.Fragment>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
            <Card>
              <CardHeader title="Estado de resultados" subtitle="Por moneda, sin mezclar" />
              <table className="tbl">
                <thead><tr><th>Concepto</th>{currencies.map((c) => <th key={c} className="text-right">{c}</th>)}</tr></thead>
                <tbody>
                  {ROWS.map((r) => (
                    <tr key={r.key}>
                      <td className={cx(["operatingProfit", "cashFlow", "contributionMargin"].includes(r.key) && "font-medium")}>
                        <span className="inline-flex items-center gap-1">{r.label}<InfoTip content={r.hint} /></span>
                      </td>
                      {currencies.map((c) => {
                        const v = cur[c]?.[r.key] ?? 0;
                        return (
                          <td key={c} className="text-right">
                            <div className={cx("tabular", ["operatingProfit", "cashFlow", "contributionMargin"].includes(r.key) && "font-medium", v < 0 && "text-danger")}>{formatMoney(v, c)}</div>
                            <Delta inverse={r.inverse} value={pctChange(v, old[c]?.[r.key])} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td><span className="inline-flex items-center gap-1">ROI del período<InfoTip content="(ingresos netos − comisiones − gastos − inversión) / (comisiones + gastos + inversión)" /></span></td>
                    {currencies.map((c) => <td key={c} className="text-right tabular">{roi(cur[c]) === null ? "—" : fmtPct(roi(cur[c])! * 100, 0)}</td>)}
                  </tr>
                </tbody>
              </table>
              <div className="border-t border-line px-4 py-2"><ConvertedTotal bag={Object.fromEntries(currencies.map((c) => [c, cur[c]?.operatingProfit ?? 0]))} label="Beneficio consolidado ≈" /></div>
            </Card>
            <div className="space-y-4">
              <Card>
                <CardHeader title="Evolución" actions={currencies.length > 1 && <Select className="w-24" value={cc} onChange={(e) => setChartCur(e.target.value)}>{currencies.map((c) => <option key={c}>{c}</option>)}</Select>} />
                <div className="px-2 pb-3"><FinanceChart data={buildSeries(txs.data ?? [], range, bucketFor(range), cc)} series={["income", "expenses", "profit"]} currency={cc} bucket={bucketFor(range)} height={220} kind="bar" /></div>
              </Card>
              <Card>
                <CardHeader title="Rentabilidad por proyecto" subtitle={`Beneficio operativo · ${RANGE_LABEL[preset]}`} />
                <ul className="px-4 pb-3">
                  {proj.sort((a, b) => (b.summary[cc]?.operatingProfit ?? 0) - (a.summary[cc]?.operatingProfit ?? 0)).map((p) => {
                    const pr = projects.data?.find((x) => x.id === p.projectId);
                    return (
                      <li key={p.projectId ?? "none"} className="flex items-center gap-2 border-b border-line py-1.5 text-[12.5px] last:border-0">
                        {pr ? <ProjectAvatar project={pr} size={20} /> : <span className="size-5 rounded-md bg-surface-3" />}
                        <span className="flex-1 truncate">{pr?.name ?? "Sin proyecto"}</span>
                        {Object.entries(p.summary).map(([c, b]) => <span key={c} className={cx("tabular", b.operatingProfit < 0 && "text-danger")}>{formatMoney(b.operatingProfit, c, { compact: true })}</span>)}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TransactionsTab() {
  const [params, setParams] = useSearchParams();
  const projects = useProjects();
  const toast = useToast();
  const [search, setSearch] = React.useState("");
  const [kind, setKind] = React.useState<string>(params.get("kind") ?? "");
  const [projectId, setProjectId] = React.useState("");
  const [currency, setCurrency] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [showDeleted, setShowDeleted] = React.useState(false);
  const [editing, setEditing] = React.useState<Transaction | null>(null);
  const [history, setHistory] = React.useState<Transaction | null>(null);
  const filter = { search: search || undefined, kind: (kind || undefined) as TxKind | undefined, projectId: projectId || undefined, currency: currency || undefined, status: (status || undefined) as "cleared" | undefined, from: from || undefined, to: to || undefined, includeDeleted: showDeleted };
  const txs = useData(["transactions", "list", filter], () => listTransactions(filter));
  const del = useAction((id: string) => deleteTransaction(id), { success: "Transacción eliminada (recuperable)" });
  const restore = useAction((id: string) => restoreTransaction(id), { success: "Transacción restaurada" });
  const parentRef = React.useRef<HTMLDivElement>(null);
  const rows = txs.data ?? [];
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 44, overscan: 12 });

  React.useEffect(() => {
    const id = params.get("tx");
    if (id) void getTransaction(id).then((t) => t && setEditing(t));
  }, [params]);

  const exportCsv = async () => {
    const pname = (id: string | null) => projects.data?.find((p) => p.id === id)?.name ?? "";
    const csv = toCsv(rows.filter((r) => !r.deleted_at).map((t) => ({ fecha: t.occurred_on, tipo: t.kind, categoria: t.category, descripcion: t.description, contraparte: t.counterparty, importe: (t.amount_minor / 100).toFixed(2), moneda: t.currency, estado: t.status, proyecto: pname(t.project_id), fuente: t.source, id_externo: t.external_id })));
    const path = await saveFile(`sovare-transacciones-${todayStr()}.csv`, csv, "csv");
    if (path) toast.show({ title: "CSV exportado", body: path, tone: "success" });
  };

  const totals = summarize(rows);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input className="w-56 pl-7" placeholder="Descripción, contraparte, notas" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar transacciones" />
        </div>
        <Select className="w-36" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {Object.entries(TX_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select className="w-44" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Proyecto">
          <option value="">Todos los proyectos</option>
          <option value="none">Sin proyecto</option>
          {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select className="w-28" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Moneda"><option value="">Moneda</option><option>USD</option><option>ARS</option></Select>
        <Select className="w-32" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Estado"><option value="">Estado</option><option value="cleared">Cobrado/pagado</option><option value="pending">Pendiente</option></Select>
        <Input type="date" className="w-36" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
        <Input type="date" className="w-36" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
        <label className="flex items-center gap-1.5 text-[12px] text-ink-2"><input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />Eliminadas</label>
        <Button className="ml-auto" icon={<Download className="size-3.5" />} onClick={() => void exportCsv()} disabled={!rows.length}>Exportar CSV</Button>
      </div>
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[96px_110px_1fr_160px_150px_130px_36px] border-b border-line bg-surface px-3 py-2 text-[11.5px] font-medium text-ink-3">
          <span>Fecha</span><span>Tipo</span><span>Descripción</span><span>Proyecto</span><span>Categoría</span><span className="text-right">Importe</span><span />
        </div>
        {txs.isLoading ? (
          <Skeleton className="m-3 h-40" />
        ) : !rows.length ? (
          <EmptyState compact title="Sin transacciones" body="Ajustá los filtros, registrá un movimiento o importá un CSV." />
        ) : (
          <div ref={parentRef} className="max-h-[560px] overflow-y-auto">
            <div style={{ height: v.getTotalSize(), position: "relative" }}>
              {v.getVirtualItems().map((vi) => {
                const t = rows[vi.index];
                const p = projects.data?.find((x) => x.id === t.project_id);
                const negative = t.kind !== "income";
                return (
                  <div key={t.id} onDoubleClick={() => !t.deleted_at && setEditing(t)} style={{ position: "absolute", top: 0, left: 0, right: 0, height: vi.size, transform: `translateY(${vi.start}px)` }} className={cx("grid grid-cols-[96px_110px_1fr_160px_150px_130px_36px] items-center border-b border-line px-3 text-[12.5px] hover:bg-surface-2", t.deleted_at && "opacity-50 line-through")}>
                    <span className="tabular text-ink-2">{fmtDate(t.occurred_on, "dd/MM/yy")}</span>
                    <span className="flex items-center gap-1"><Badge tone={t.kind === "income" ? "success" : t.kind === "investment" ? "info" : t.kind === "refund" ? "warning" : "neutral"}>{TX_KIND_LABEL[t.kind]}</Badge>{t.status === "pending" && <Badge tone="warning">pend.</Badge>}</span>
                    <span className="flex min-w-0 items-center gap-1.5 truncate">
                      <span className="truncate">{t.description ?? "—"}</span>
                      {t.counterparty && <span className="truncate text-ink-3">· {t.counterparty}</span>}
                      {t.attachment && <Paperclip className="size-3 shrink-0 text-ink-3" />}
                      {t.source !== "manual" && <span className="shrink-0 text-[10.5px] uppercase text-ink-3">{t.source}</span>}
                    </span>
                    <span className="truncate text-ink-2">{p?.name ?? "—"}</span>
                    <span className="truncate text-ink-2">{categoryLabel(t.category)}</span>
                    <span className={cx("text-right font-medium tabular", t.kind === "income" ? "text-success" : "")}>{negative ? "−" : "+"}{formatMoney(t.amount_minor, t.currency)}</span>
                    <Menu
                      trigger={<Button size="xs" variant="ghost" icon={<MoreHorizontal className="size-4" />} aria-label="Acciones" />}
                      items={t.deleted_at ? [{ label: "Restaurar", onSelect: () => void restore.run(t.id) }, { label: "Historial", icon: <History className="size-3.5" />, onSelect: () => setHistory(t) }] : [
                        { label: "Editar", onSelect: () => setEditing(t) },
                        ...(t.attachment ? [{ label: "Ver comprobante", onSelect: () => void openAttachment(t.attachment!) }] : []),
                        { label: "Historial de cambios", icon: <History className="size-3.5" />, onSelect: () => setHistory(t) },
                        "sep" as const,
                        { label: "Eliminar", danger: true, onSelect: () => void del.run(t.id) },
                      ]}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-4 border-t border-line px-4 py-2 text-[12px] text-ink-2">
          <span>{rows.filter((r) => !r.deleted_at).length} transacciones</span>
          {Object.entries(totals).map(([c, b]) => <span key={c} className="tabular">{c}: ingresos netos {formatMoney(b.netRevenue, c)} · egresos {formatMoney(b.operatingExpenses + b.fees + b.investment, c)}</span>)}
        </div>
      </Card>
      <TransactionDialog open={!!editing} tx={editing} onClose={() => (setEditing(null), params.get("tx") && setParams({ tab: "transactions" }))} />
      <AuditSheet tx={history} onClose={() => setHistory(null)} />
    </div>
  );
}

function AuditSheet({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const trail = useData(["audit", tx?.id], () => auditTrail("transaction", tx!.id), { enabled: !!tx });
  return (
    <Sheet open={!!tx} onOpenChange={(o) => !o && onClose()} title="Historial de cambios" subtitle="Correcciones auditables: cada versión anterior se conserva">
      <ol className="space-y-3">
        {(trail.data ?? []).map((a) => {
          const after = parseJson<Record<string, unknown>>(a.after, {});
          const before = parseJson<Record<string, unknown>>(a.before, {});
          return (
            <li key={a.id} className="rounded-lg border border-line p-3 text-[12.5px]">
              <p className="mb-1 font-medium">{{ create: "Creada", update: "Editada", delete: "Eliminada", restore: "Restaurada" }[a.action as "create"]} · {relTime(a.at)}</p>
              {a.action === "update" && (
                <ul className="space-y-0.5 text-ink-2">
                  {Object.keys(after).filter((k) => k !== "updated_at" && JSON.stringify(after[k]) !== JSON.stringify(before[k])).map((k) => (
                    <li key={k}><span className="text-ink-3">{k}:</span> {String(before[k] ?? "—")} → {String(after[k] ?? "—")}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </Sheet>
  );
}

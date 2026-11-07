import * as React from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { Check, Plus, RefreshCw, Trash2, Pencil, FlaskConical } from "lucide-react";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, InfoTip, Progress, Select, Skeleton, Switch } from "@/components/ui/primitives";
import { useApp } from "@/app/AppContext";
import { useAction, useData } from "@/app/hooks";
import { useProjects, useRates } from "@/app/queries";
import { addRate, deleteBudget, deleteRate, deleteRecurring, listBudgets, listRecurring, listTransactions, markRecurringPaid, saveBudget, saveRecurring, type RecurringInput } from "@/repos/finance";
import { listObservations } from "@/repos/metrics";
import { listAdMetrics, listCampaigns } from "@/repos/marketing";
import { syncConnector } from "@/integrations/runner";
import { breakEven, burnRate, byProject, monthly, monthlyEquivalent, revenueConcentration, summarize } from "@/domain/finance";
import { simulate, cacPayback, type ScenarioInput } from "@/domain/scenario";
import { formatMoney, fromMinor, parseAmount, toMinor, SUPPORTED_CURRENCIES } from "@/domain/money";
import { CATEGORIES, categoryLabel } from "@/domain/categories";
import type { RecurringCost } from "@/domain/types";
import { fmtDate, fmtPct } from "@/lib/format";
import { addDays, cx, todayStr } from "@/lib/util";
import { FinanceChart } from "@/components/charts/FinanceChart";

// ------------------------------------------------------------- Recurring / subscriptions
export function RecurringTab() {
  const list = useData(["recurring"], listRecurring);
  const projects = useProjects();
  const [editing, setEditing] = React.useState<RecurringCost | "new" | null>(null);
  const pay = useAction((id: string) => markRecurringPaid(id), { success: "Pago registrado como gasto y próximo vencimiento actualizado" });
  const del = useAction((id: string) => deleteRecurring(id), { success: "Costo recurrente eliminado" });
  const active = (list.data ?? []).filter((r) => r.active);
  const monthlyBag: Record<string, number> = {};
  for (const r of active) monthlyBag[r.currency] = (monthlyBag[r.currency] ?? 0) + monthlyEquivalent(r.amount_minor, r.interval);
  const byCat = new Map<string, Record<string, number>>();
  for (const r of active) {
    const m = byCat.get(r.category) ?? {};
    m[r.currency] = (m[r.currency] ?? 0) + monthlyEquivalent(r.amount_minor, r.interval);
    byCat.set(r.category, m);
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4">
          <p className="text-[11.5px] font-medium text-ink-3">Costo recurrente mensual equivalente</p>
          <div className="mt-1 text-[19px] font-semibold tabular">{Object.keys(monthlyBag).length ? Object.entries(monthlyBag).map(([c, v]) => <div key={c}>{formatMoney(v, c)}</div>) : "—"}</div>
          <p className="text-[11.5px] text-ink-3">{active.length} suscripciones activas</p>
        </Card>
        <Card className="p-4 md:col-span-2">
          <p className="mb-2 text-[11.5px] font-medium text-ink-3">Por categoría (mensual)</p>
          <div className="flex flex-wrap gap-2">
            {[...byCat.entries()].map(([cat, bag]) => <Badge key={cat}>{categoryLabel(cat)}: {Object.entries(bag).map(([c, v]) => formatMoney(v, c, { compact: true })).join(" + ")}</Badge>)}
            {!byCat.size && <span className="text-[12px] text-ink-3">Sin datos</span>}
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Subscription Tracker" subtitle="Hosting, dominios, APIs, herramientas de IA, diseño… Marcá como pagado para registrar el gasto." actions={<Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>Agregar</Button>} />
        {list.isLoading ? <Skeleton className="m-4 h-32" /> : !(list.data ?? []).length ? (
          <EmptyState compact title="Sin costos recurrentes" body="Registrá tus suscripciones para recibir avisos de renovación y medir el costo fijo real." />
        ) : (
          <table className="tbl">
            <thead><tr><th>Servicio</th><th>Proyecto</th><th>Categoría</th><th className="text-right">Importe</th><th>Frecuencia</th><th>Próximo vencimiento</th><th /></tr></thead>
            <tbody>
              {(list.data ?? []).map((r) => {
                const days = r.next_due_on ? Math.round((Date.parse(r.next_due_on) - Date.parse(todayStr())) / 86400000) : null;
                return (
                  <tr key={r.id} className={cx(!r.active && "opacity-50")}>
                    <td><p className="font-medium">{r.name}</p>{r.vendor && <p className="text-[11.5px] text-ink-3">{r.vendor}</p>}</td>
                    <td className="text-ink-2">{projects.data?.find((p) => p.id === r.project_id)?.name ?? "General"}</td>
                    <td className="text-ink-2">{categoryLabel(r.category)}</td>
                    <td className="text-right tabular">{formatMoney(r.amount_minor, r.currency)}</td>
                    <td className="text-ink-2">{{ weekly: "Semanal", monthly: "Mensual", quarterly: "Trimestral", yearly: "Anual" }[r.interval]}</td>
                    <td>{r.next_due_on ? <span className={cx(days !== null && days < 0 && "text-danger", days !== null && days >= 0 && days <= 7 && "text-warning")}>{fmtDate(r.next_due_on)}{days !== null && ` · ${days < 0 ? `vencido hace ${-days} d` : days === 0 ? "hoy" : `en ${days} d`}`}</span> : "—"}</td>
                    <td className="whitespace-nowrap text-right">
                      {r.active && <Button size="xs" icon={<Check className="size-3.5" />} onClick={() => void pay.run(r.id)}>Pagado</Button>}
                      <Button size="xs" variant="ghost" icon={<Pencil className="size-3.5" />} aria-label="Editar" onClick={() => setEditing(r)} />
                      <Button size="xs" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label="Eliminar" onClick={() => void del.run(r.id)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <RecurringDialog value={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function RecurringDialog({ value, onClose }: { value: RecurringCost | "new" | null; onClose: () => void }) {
  const projects = useProjects();
  const app = useApp();
  const r = value && value !== "new" ? value : null;
  const [f, setF] = React.useState<Record<string, string>>({});
  const [active, setActive] = React.useState(true);
  React.useEffect(() => {
    if (!value) return;
    setF({ name: r?.name ?? "", vendor: r?.vendor ?? "", category: r?.category ?? "tools", amount: r ? String(fromMinor(r.amount_minor, r.currency)).replace(".", ",") : "", currency: r?.currency ?? app.reportingCurrency, interval: r?.interval ?? "monthly", next_due_on: r?.next_due_on ?? "", project_id: r?.project_id ?? "", url: r?.url ?? "", notes: r?.notes ?? "" });
    setActive(r?.active ?? true);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(async () => {
    const amount = parseAmount(f.amount);
    if (!(amount >= 0)) throw new Error("Importe inválido");
    const input: RecurringInput = { name: f.name, vendor: f.vendor || null, category: f.category, amount_minor: toMinor(amount, f.currency), currency: f.currency, interval: f.interval as RecurringInput["interval"], next_due_on: f.next_due_on || null, project_id: f.project_id || null, url: f.url || null, notes: f.notes || null, active };
    await saveRecurring(input, r?.id);
  }, { success: "Guardado" });
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} title={r ? "Editar costo recurrente" : "Nuevo costo recurrente"} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!f.name} loading={save.pending} onClick={async () => { await save.run(); onClose(); }}>Guardar</Button></>}>
      <div className="grid grid-cols-2 gap-3 pb-3">
        <Field label="Servicio"><Input autoFocus value={f.name ?? ""} onChange={s("name")} placeholder="Vercel Pro" /></Field>
        <Field label="Proveedor"><Input value={f.vendor ?? ""} onChange={s("vendor")} /></Field>
        <Field label="Importe"><Input value={f.amount ?? ""} onChange={s("amount")} inputMode="decimal" /></Field>
        <Field label="Moneda"><Select value={f.currency} onChange={s("currency")}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Frecuencia"><Select value={f.interval} onChange={s("interval")}><option value="weekly">Semanal</option><option value="monthly">Mensual</option><option value="quarterly">Trimestral</option><option value="yearly">Anual</option></Select></Field>
        <Field label="Próximo vencimiento"><Input type="date" value={f.next_due_on ?? ""} onChange={s("next_due_on")} /></Field>
        <Field label="Categoría"><Select value={f.category} onChange={s("category")}>{CATEGORIES.filter((c) => c.kinds.includes("expense")).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
        <Field label="Proyecto"><Select value={f.project_id} onChange={s("project_id")}><option value="">General</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="URL de gestión" className="col-span-2"><Input value={f.url ?? ""} onChange={s("url")} placeholder="https://" /></Field>
        <label className="col-span-2 flex items-center gap-2 text-[12.5px]"><Switch checked={active} onChange={setActive} label="Activo" /> Activo</label>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------- Budgets
export function BudgetsTab() {
  const [month, setMonth] = React.useState(todayStr().slice(0, 7));
  const projects = useProjects();
  const app = useApp();
  const budgets = useData(["budgets", month], () => listBudgets(month));
  const txs = useData(["transactions", "month", month], () => listTransactions({ from: `${month}-01`, to: `${month}-31` }));
  const [projectId, setProjectId] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [currency, setCurrency] = React.useState(app.reportingCurrency);
  const save = useAction(async () => saveBudget(projectId || null, month, currency, toMinor(parseAmount(amount), currency)), { success: "Presupuesto guardado" });
  const del = useAction((id: string) => deleteBudget(id));
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Mes"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" /></Field>
          <Field label="Proyecto"><Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-52"><option value="">Global (todos)</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Monto mensual"><Input value={amount} onChange={(e) => setAmount(e.target.value)} className="w-36" inputMode="decimal" /></Field>
          <Field label="Moneda"><Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-24">{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Button variant="primary" icon={<Plus className="size-3.5" />} disabled={!(parseAmount(amount) > 0)} onClick={async () => (await save.run(), setAmount(""))}>Asignar</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title={`Budget Planner · ${fmtDate(month + "-01", "MMMM yyyy")}`} subtitle="Gasto = gastos operativos + comisiones + inversión del mes" />
        {!(budgets.data ?? []).length ? <EmptyState compact title="Sin presupuestos para este mes" /> : (
          <div className="space-y-3 px-4 pb-4">
            {(budgets.data ?? []).map((b) => {
              const list = (txs.data ?? []).filter((t) => b.project_id === null || t.project_id === b.project_id);
              const s = summarize(list)[b.currency];
              const spent = (s?.operatingExpenses ?? 0) + (s?.fees ?? 0) + (s?.investment ?? 0);
              const pct = b.amount_minor ? (spent / b.amount_minor) * 100 : 0;
              return (
                <div key={b.id}>
                  <div className="mb-1 flex items-center justify-between text-[12.5px]">
                    <span className="font-medium">{projects.data?.find((p) => p.id === b.project_id)?.name ?? "Global"}</span>
                    <span className="flex items-center gap-2 tabular text-ink-2">
                      {formatMoney(spent, b.currency)} / {formatMoney(b.amount_minor, b.currency)} · <span className={cx(pct > 100 ? "text-danger" : pct > 80 ? "text-warning" : "")}>{fmtPct(pct, 0)}</span>
                      <Button size="xs" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label="Eliminar" onClick={() => void del.run(b.id)} />
                    </span>
                  </div>
                  <Progress value={pct} tone={pct > 100 ? "danger" : pct > 80 ? "warning" : "accent"} />
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------- Intelligence
export function IntelligenceTab() {
  const txs = useData(["transactions", "all"], () => listTransactions());
  const projects = useProjects();
  const recurring = useData(["recurring"], listRecurring);
  const newCustomers = useData(["metrics", "new_customers"], () => listObservations({ metricKey: "new_customers" }));
  const camps = useData(["campaigns"], listCampaigns);
  const ads = useData(["ad_metrics", "90"], () => listAdMetrics(addDays(todayStr(), -89), todayStr()));
  const [cur, setCur] = React.useState("USD");
  if (txs.isLoading) return <Skeleton className="h-96" />;
  const all = txs.data ?? [];
  const currencies = Object.keys(summarize(all));
  const c = currencies.includes(cur) ? cur : currencies[0] ?? "USD";
  const month = todayStr().slice(0, 7);
  const r90 = { from: addDays(todayStr(), -89), to: todayStr() };
  const pname = (id: string | null) => projects.data?.find((p) => p.id === id)?.name ?? "Sin proyecto";
  const per = byProject(all, r90).map((p) => ({ id: p.projectId, b: p.summary[c] })).filter((x) => x.b);
  const best = [...per].sort((a, b) => b.b.operatingProfit - a.b.operatingProfit)[0];
  const spendiest = [...per].sort((a, b) => b.b.operatingExpenses + b.b.fees - (a.b.operatingExpenses + a.b.fees))[0];
  const s90 = summarize(all, r90)[c];
  const burn = burnRate(all, c, month);
  const be = breakEven(all, c, month);
  const conc = revenueConcentration(all, c, r90);
  const mon = monthly(all, c).slice(-12);
  const rec = (recurring.data ?? []).filter((r) => r.active && r.currency === c).reduce((s, r) => s + monthlyEquivalent(r.amount_minor, r.interval), 0);
  // customer acquisition: ad spend (platform-reported, same currency) vs new customers recorded
  const adSpend = (ads.data ?? []).filter((m) => m.currency === c).reduce((s, m) => s + (m.spend_minor ?? 0), 0);
  const nc = (newCustomers.data ?? []).filter((o) => o.period_end >= r90.from).reduce((s, o) => s + o.value, 0);
  const cac = cacPayback(adSpend, nc, 0);
  const card = (title: string, value: React.ReactNode, note: React.ReactNode, kind: "hecho" | "estimación" = "hecho") => (
    <Card className="p-4">
      <div className="flex items-start justify-between"><p className="text-[11.5px] font-medium text-ink-3">{title}</p><Badge tone={kind === "hecho" ? "info" : "accent"}>{kind}</Badge></div>
      <div className="mt-1 text-[17px] font-semibold tabular">{value}</div>
      <p className="mt-0.5 text-[12px] text-ink-3">{note}</p>
    </Card>
  );
  if (!currencies.length) return <Card><EmptyState title="Sin datos financieros" body="Financial Intelligence se calcula sobre transacciones registradas." /></Card>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><span className="text-[12.5px] text-ink-3">Moneda de análisis</span><Select className="w-24" value={c} onChange={(e) => setCur(e.target.value)}>{currencies.map((x) => <option key={x}>{x}</option>)}</Select><span className="text-[12px] text-ink-3">Últimos 90 días salvo indicación</span></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {card("Proyecto más rentable", best && best.b.operatingProfit > 0 ? pname(best.id) : "—", best && best.b.operatingProfit > 0 ? `Beneficio ${formatMoney(best.b.operatingProfit, c)}` : "Ningún proyecto con beneficio positivo")}
        {card("Proyecto con mayor gasto", spendiest ? pname(spendiest.id) : "—", spendiest ? formatMoney(spendiest.b.operatingExpenses + spendiest.b.fees, c) : "Sin gastos")}
        {card("Margen de contribución", s90 ? formatMoney(s90.contributionMargin, c) : "—", s90 && s90.netRevenue > 0 ? `${fmtPct((s90.contributionMargin / s90.netRevenue) * 100, 0)} de los ingresos netos` : "Sin ingresos")}
        {card("Costos recurrentes", rec ? `${formatMoney(rec, c)}/mes` : "—", "Equivalente mensual de suscripciones activas")}
        {card("Burn rate", burn === null ? "—" : burn === 0 ? "Sin quema" : `${formatMoney(burn, c)}/mes`, "Promedio de flujo de caja negativo, últimos 3 meses completos", "estimación")}
        {card("Break-even", be.status === "reached" ? "Alcanzado" : be.status === "projected" ? `≈ ${be.months} meses` : be.status === "not_profitable" ? "No proyectable" : "Sin datos", be.status === "projected" ? `Faltan recuperar ${formatMoney(be.remaining!, c)} al ritmo de los últimos 3 meses` : be.status === "not_profitable" ? "El beneficio operativo reciente no es positivo" : "Recupero de inversión + pérdidas acumuladas", "estimación")}
        {card("Concentración de ingresos", conc ? fmtPct(conc.share * 100, 0) : "—", conc ? `Proviene de ${pname(conc.projectId)}` : "Sin ingresos")}
        {card("Adquisición de clientes (CAC)", cac.cac === null ? "—" : formatMoney(Math.round(cac.cac), c), cac.cac === null ? (adSpend ? "Registrá la métrica ‘Nuevos clientes’ en Analytics" : "Requiere gasto publicitario sincronizado y nuevos clientes") : `${formatMoney(adSpend, c)} en anuncios / ${nc} clientes nuevos`, "estimación")}
      </div>
      <Card>
        <CardHeader title="Evolución mensual" subtitle={`${c} · últimos 12 meses con movimientos`} />
        <div className="px-2 pb-3">
          {mon.length ? <FinanceChart data={mon.map((m) => ({ bucket: m.month, income: m.netRevenue, expenses: m.operatingExpenses, profit: m.operatingProfit }))} series={["income", "expenses", "profit"]} currency={c} bucket="month" kind="bar" /> : <p className="py-10 text-center text-[12.5px] text-ink-3">Sin datos</p>}
        </div>
      </Card>
      {(camps.data ?? []).length === 0 && <p className="text-[12px] text-ink-3">Rentabilidad de adquisición: conectá Meta Ads para cruzar gasto publicitario con clientes nuevos.</p>}
    </div>
  );
}

// ------------------------------------------------------------- Simulator
const DEFAULT_SCENARIO: ScenarioInput = { months: 24, startCustomers: 10, newCustomersPerMonth: 5, churnPct: 4, pricePerCustomer: 20, variableCostPct: 8, fixedCostsPerMonth: 60, adSpendPerMonth: 100, initialInvestment: 1500 };

export function SimulatorTab() {
  const [s, setS] = React.useState<ScenarioInput>(DEFAULT_SCENARIO);
  const [cur, setCur] = React.useState("USD");
  const res = simulate(s);
  const num = (k: keyof ScenarioInput, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input type="number" value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) || 0 })} />
    </Field>
  );
  const last = res.rows[res.rows.length - 1];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-[12.5px] text-ink-2">
        <FlaskConical className="size-4 text-accent" /> Scenario Simulator: todo lo que ves acá es una <b>proyección hipotética</b> con tus supuestos. No se guarda como dato real ni se mezcla con resultados registrados.
      </div>
      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3">
            {num("months", "Meses")}
            <Field label="Moneda"><Select value={cur} onChange={(e) => setCur(e.target.value)}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            {num("startCustomers", "Clientes iniciales")}
            {num("newCustomersPerMonth", "Nuevos / mes")}
            {num("churnPct", "Churn mensual %")}
            {num("pricePerCustomer", "Precio / cliente / mes")}
            {num("variableCostPct", "Costo variable %", "Comisiones, IA…")}
            {num("fixedCostsPerMonth", "Costos fijos / mes")}
            {num("adSpendPerMonth", "Publicidad / mes")}
            {num("initialInvestment", "Inversión inicial")}
          </div>
          <Button size="sm" variant="ghost" className="mt-3" onClick={() => setS(DEFAULT_SCENARIO)}>Restablecer supuestos</Button>
        </Card>
        <Card>
          <CardHeader title="Proyección" subtitle={res.breakEvenMonth !== null ? `Break-even proyectado en el mes ${res.breakEvenMonth}` : `Sin break-even en ${s.months} meses`} actions={<Badge tone="accent">Proyección</Badge>} />
          <div className="h-72 px-2 pb-2">
            <ResponsiveContainer>
              <AreaChart data={res.rows}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="month" stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--ink-3)" fontSize={11} tickLine={false} axisLine={false} width={60} tickFormatter={(v: number) => formatMoney(toMinor(v, cur), cur, { compact: true }).replace(cur + " ", "")} />
                <Tooltip formatter={(v, n) => [formatMoney(toMinor(Number(v ?? 0), cur), cur), ({ revenue: "Ingresos", costs: "Costos", cumulative: "Acumulado" } as Record<string, string>)[String(n)] ?? String(n)]} labelFormatter={(l) => `Mes ${l}`} contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }} />
                <ReferenceLine y={0} stroke="var(--line-strong)" />
                <Area dataKey="revenue" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.08} strokeWidth={2} strokeDasharray="5 3" />
                <Area dataKey="costs" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.06} strokeWidth={2} strokeDasharray="5 3" />
                <Area dataKey="cumulative" stroke="var(--chart-3)" fill="none" strokeWidth={2} strokeDasharray="5 3" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-line px-4 py-3 text-[12.5px]">
            <div><p className="text-ink-3">Clientes al final</p><p className="font-semibold tabular">{last?.customers ?? 0}</p></div>
            <div><p className="text-ink-3">Ingreso mensual final</p><p className="font-semibold tabular">{formatMoney(toMinor(last?.revenue ?? 0, cur), cur)}</p></div>
            <div><p className="text-ink-3">Resultado acumulado</p><p className={cx("font-semibold tabular", (last?.cumulative ?? 0) < 0 && "text-danger")}>{formatMoney(toMinor(last?.cumulative ?? 0, cur), cur)}</p></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- FX rates
export function RatesTab() {
  const rates = useRates();
  const app = useApp();
  const [f, setF] = React.useState({ base: "USD", quote: "ARS", rate: "", as_of: todayStr(), source: "manual" });
  const add = useAction(() => addRate(f.base, f.quote, parseAmount(f.rate), f.as_of, f.source), { success: "Tipo de cambio guardado" });
  const del = useAction((id: string) => deleteRate(id));
  const sync = useAction(() => syncConnector("fx_dolarapi"), { success: (r) => (r.ok ? `DolarAPI: ${r.message}` : null) });
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <p className="flex-1 text-[12.5px] text-ink-2">Los importes se guardan siempre en su moneda original. Las conversiones son opcionales, explícitas y muestran fuente y fecha del tipo de cambio usado.</p>
          <Field label="Moneda de reporte"><Select className="w-24" value={app.reportingCurrency} onChange={(e) => app.setReportingCurrency(e.target.value)}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Button icon={<RefreshCw className="size-3.5" />} loading={sync.pending} onClick={() => void sync.run()}>Actualizar desde DolarAPI</Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="1 unidad de"><Select className="w-24" value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="equivale a"><Input className="w-32" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} inputMode="decimal" placeholder="1450,50" /></Field>
          <Field label="Moneda"><Select className="w-24" value={f.quote} onChange={(e) => setF({ ...f, quote: e.target.value })}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Fecha"><Input type="date" className="w-40" value={f.as_of} onChange={(e) => setF({ ...f, as_of: e.target.value })} /></Field>
          <Field label="Fuente"><Input className="w-48" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="BNA, MEP, manual…" /></Field>
          <Button variant="primary" icon={<Plus className="size-3.5" />} disabled={!(parseAmount(f.rate) > 0)} onClick={() => void add.run()}>Agregar</Button>
          <InfoTip content="Para convertir se usa el tipo más reciente con fecha igual o anterior a la del cálculo." />
        </div>
      </Card>
      <Card>
        <table className="tbl">
          <thead><tr><th>Par</th><th className="text-right">Tipo</th><th>Fecha</th><th>Fuente</th><th /></tr></thead>
          <tbody>
            {!(rates.data ?? []).length && <tr><td colSpan={5} className="py-8 text-center text-ink-3">Sin tipos de cambio registrados: no se realizan conversiones.</td></tr>}
            {(rates.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.base} → {r.quote}</td>
                <td className="text-right tabular">{r.rate.toLocaleString("es-AR", { maximumFractionDigits: 6 })}</td>
                <td>{fmtDate(r.as_of)}</td>
                <td className="text-ink-2">{r.source}</td>
                <td className="text-right"><Button size="xs" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label="Eliminar" onClick={() => void del.run(r.id)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

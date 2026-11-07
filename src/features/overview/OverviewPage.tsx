import * as React from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Bell, CheckCircle2, CircleDollarSign, FolderKanban, Megaphone, PiggyBank, Rocket, Settings2, Sparkles, TrendingUp, Wallet, ListTodo, Activity as ActivityIcon, Eye, EyeOff, ChevronUp, ChevronDown, Search } from "lucide-react";
import { useApp } from "@/app/AppContext";
import { useAction, useData } from "@/app/hooks";
import { useProjects, useTasks } from "@/app/queries";
import { listTransactions } from "@/repos/finance";
import { listAlerts, setAlertStatus } from "@/repos/alerts";
import { listCampaigns } from "@/repos/marketing";
import { listDeployments } from "@/repos/dev";
import { getPref, setPref } from "@/repos/core";
import { buildDailyBrief } from "@/ai/brief";
import { generateInsights, topActions } from "@/ai/localEngine";
import { summarize, pick, series as buildSeries, byProject } from "@/domain/finance";
import { bucketFor, monthRange, previousMonthRange, rangeFor, RANGE_LABEL, type DateRange, type RangePreset } from "@/domain/periods";
import { ACTIVE_STATUSES, LIVE_STATUSES, STATUS_LABEL, type Project } from "@/domain/types";
import { bagCurrencies, formatMoney, type MoneyBag } from "@/domain/money";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Menu, NoData, Segmented, Select, Skeleton, Tip } from "@/components/ui/primitives";
import { Delta, MoneyBagView, ProjectAvatar, SeverityBadge, Stat, StatusBadge } from "@/components/common";
import { ConvertedTotal } from "@/components/Converted";
import { FinanceChart, SERIES, type SeriesKey } from "@/components/charts/FinanceChart";
import { relTime, fmtDate } from "@/lib/format";
import { cx, todayStr, addDays } from "@/lib/util";
import { pctChange } from "@/domain/periods";

type WidgetId = "kpis" | "brief" | "chart" | "attention" | "projects";
const WIDGETS: Record<WidgetId, string> = { kpis: "Indicadores", brief: "Daily Brief y prioridades", chart: "Gráfico financiero", attention: "What needs your attention?", projects: "Resumen de proyectos" };
const DEFAULT_LAYOUT = (Object.keys(WIDGETS) as WidgetId[]).map((id) => ({ id, visible: true }));

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches";
}

/** Month-over-month change in ONE currency (the reporting currency when present); never mixes currencies. */
function bagDelta(cur: MoneyBag, prev: MoneyBag, preferred = "USD"): number | null {
  const cs = bagCurrencies(cur, prev);
  const c = cs.includes(preferred) ? preferred : cs[0];
  if (!c) return null;
  return pctChange(cur[c] ?? 0, prev[c]);
}

export default function OverviewPage() {
  const app = useApp();
  const nav = useNavigate();
  const projects = useProjects();
  const tasks = useTasks();
  const txs = useData(["transactions", "all"], () => listTransactions());
  const alerts = useData(["alerts", "open"], () => listAlerts("open"));
  const campaigns = useData(["campaigns"], listCampaigns);
  const deploys = useData(["deployments"], () => listDeployments({ limit: 300 }));
  const brief = useData(["brief", app.previousVisit], () => buildDailyBrief(app.previousVisit));
  const insights = useData(["insights"], () => generateInsights());
  const layout = useData(["prefs", "overview.widgets"], () => getPref("overview.widgets", DEFAULT_LAYOUT));
  const saveLayout = useAction((l: typeof DEFAULT_LAYOUT) => setPref("overview.widgets", l));
  const dismiss = useAction((id: string) => setAlertStatus(id, "dismissed"), { success: "Alerta descartada" });

  const today = todayStr();
  const month = monthRange(today);
  const prevMonth = previousMonthRange(today);
  const all = txs.data ?? [];
  const mSum = summarize(all, month);
  const pSum = summarize(all, prevMonth);
  const totalSum = summarize(all);
  const openTasks = (tasks.data ?? []).filter((t) => !["done", "canceled"].includes(t.status) && !t.parent_id);
  const overdue = openTasks.filter((t) => t.due_on && t.due_on < today);
  const activeAds = (campaigns.data ?? []).filter((c) => c.level === "campaign" && /active/i.test(c.status));
  const plist = projects.data ?? [];
  const importantAlerts = (alerts.data ?? []).filter((a) => a.severity !== "info");

  const widgets = (layout.data ?? DEFAULT_LAYOUT).filter((w) => w.id in WIDGETS);
  const missing = DEFAULT_LAYOUT.filter((d) => !widgets.some((w) => w.id === d.id));
  const order = [...widgets, ...missing];

  const loading = txs.isLoading || projects.isLoading;
  const rc = app.reportingCurrency;

  const blocks: Record<WidgetId, React.ReactNode> = {
    kpis: (
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {loading ? (
          Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-[84px]" />)
        ) : (
          <>
            <Stat icon={<FolderKanban />} label="Proyectos registrados" value={plist.length} sub={`${plist.filter((p) => p.status === "idea").length} ideas · ${plist.filter((p) => p.status === "archived").length} archivados`} onClick={() => nav("/projects")} />
            <Stat icon={<Rocket />} label="Proyectos activos" value={plist.filter((p) => ACTIVE_STATUSES.includes(p.status)).length} sub="En research → mantenimiento" onClick={() => nav("/projects?filter=active")} />
            <Stat icon={<CheckCircle2 />} label="En producción" value={plist.filter((p) => LIVE_STATUSES.includes(p.status)).length} sub="Launched · Production · Maint." onClick={() => nav("/projects?filter=live")} />
            <Stat icon={<CircleDollarSign />} label="Ingresos del mes" value={<MoneyBagView bag={pick(mSum, "netRevenue")} compact />} sub={<span className="flex items-center gap-1.5"><Delta value={bagDelta(pick(mSum, "netRevenue"), pick(pSum, "netRevenue"), rc)} /><ConvertedTotal bag={pick(mSum, "netRevenue")} /></span>} onClick={() => nav("/finance")} hint="Ingresos netos (facturación − reembolsos) del mes en curso, por moneda" />
            <Stat icon={<Wallet />} label="Gastos del mes" value={<MoneyBagView bag={Object.fromEntries(Object.entries(mSum).map(([c, b]) => [c, b.operatingExpenses + b.fees]).filter(([, v]) => v))} compact />} sub={<Delta inverse value={bagDelta(Object.fromEntries(Object.entries(mSum).map(([c, b]) => [c, b.operatingExpenses + b.fees])), Object.fromEntries(Object.entries(pSum).map(([c, b]) => [c, b.operatingExpenses + b.fees])), rc)} />} onClick={() => nav("/finance")} hint="Gastos operativos + comisiones (sin inversión)" />
            <Stat icon={<TrendingUp />} label="Ganancia neta (operativa)" value={<MoneyBagView bag={pick(mSum, "operatingProfit")} compact signed />} sub={<Delta value={bagDelta(pick(mSum, "operatingProfit"), pick(pSum, "operatingProfit"), rc)} />} onClick={() => nav("/finance?tab=intelligence")} hint="Ingresos netos − comisiones − gastos operativos. No incluye inversión." />
            <Stat icon={<PiggyBank />} label="Inversión acumulada" value={<MoneyBagView bag={pick(totalSum, "investment")} compact />} sub="Total registrado" onClick={() => nav("/finance?kind=investment")} />
            <Stat icon={<Megaphone />} label="Publicidades activas" value={campaigns.data?.length ? activeAds.length : <NoData kind="not_connected" />} sub={campaigns.data?.length ? `${campaigns.data.filter((c) => c.level === "campaign").length} campañas sincronizadas` : "Conectá Meta Ads"} onClick={() => nav("/marketing")} />
            <Stat icon={<Bell />} label="Alertas importantes" value={importantAlerts.length} sub={`${(alerts.data ?? []).filter((a) => a.severity === "critical").length} críticas · ${(alerts.data ?? []).length} abiertas`} onClick={() => document.getElementById("attention")?.scrollIntoView({ behavior: "smooth" })} />
            <Stat icon={<ListTodo />} label="Tareas pendientes" value={openTasks.length} sub={overdue.length ? <span className="text-danger">{overdue.length} vencidas</span> : `${openTasks.filter((t) => t.due_on === today).length} para hoy`} onClick={() => nav("/tasks")} />
          </>
        )}
      </section>
    ),
    brief: <BriefAndActions brief={brief.data} loading={brief.isLoading} actions={insights.data ? topActions(insights.data) : undefined} previousVisit={app.previousVisit} />,
    chart: <FinancialPanel txs={all} projects={plist} />,
    attention: (
      <Card id="attention">
        <CardHeader title="What needs your attention?" icon={<AlertTriangle className="size-4 text-warning" />} subtitle="Alertas generadas por reglas verificables sobre tus datos" actions={<Button size="sm" variant="ghost" onClick={() => nav("/settings?tab=alerts")}>Configurar reglas</Button>} />
        <div className="px-2 pb-2">
          {alerts.isLoading ? (
            <Skeleton className="m-2 h-24" />
          ) : !(alerts.data ?? []).length ? (
            <EmptyState compact icon={<CheckCircle2 />} title="Nada requiere tu atención" body="Las reglas se evalúan automáticamente mientras la app está abierta." />
          ) : (
            <ul>
              {(alerts.data ?? []).slice(0, 8).map((a) => (
                <li key={a.id} className="group flex items-start gap-3 rounded-lg px-2.5 py-2 hover:bg-surface-2">
                  <SeverityBadge severity={a.severity} />
                  <button className="min-w-0 flex-1 text-left" onClick={() => a.link && (a.link.startsWith("/") ? nav(a.link) : window.open(a.link))}>
                    <p className="truncate text-[13px] font-medium">{a.title}</p>
                    {a.detail && <p className="truncate text-[12px] text-ink-3">{a.detail}</p>}
                  </button>
                  <span className="shrink-0 text-[11px] text-ink-3">{relTime(a.first_seen_at)}</span>
                  <Button size="xs" variant="ghost" className="opacity-0 group-hover:opacity-100" onClick={() => void dismiss.run(a.id)}>
                    Descartar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    ),
    projects: <ProjectsSummary projects={plist} txs={all} tasks={tasks.data ?? []} deploys={deploys.data ?? []} />,
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12.5px] text-ink-3">{fmtDate(today, "EEEE d 'de' MMMM")}</p>
          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{greeting()}</h1>
        </div>
        <Menu
          trigger={<Button size="sm" icon={<Settings2 className="size-3.5" />}>Personalizar</Button>}
          items={order.flatMap((w, i) => [
            { label: `${w.visible ? "Ocultar" : "Mostrar"} · ${WIDGETS[w.id as WidgetId]}`, icon: w.visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />, onSelect: () => void saveLayout.run(order.map((x) => (x.id === w.id ? { ...x, visible: !x.visible } : x))) },
            ...(i > 0 ? [{ label: `Subir · ${WIDGETS[w.id as WidgetId]}`, icon: <ChevronUp className="size-3.5" />, onSelect: () => { const o = [...order]; [o[i - 1], o[i]] = [o[i], o[i - 1]]; void saveLayout.run(o); } }] : []),
            ...(i < order.length - 1 ? [{ label: `Bajar · ${WIDGETS[w.id as WidgetId]}`, icon: <ChevronDown className="size-3.5" />, onSelect: () => { const o = [...order]; [o[i + 1], o[i]] = [o[i], o[i + 1]]; void saveLayout.run(o); } }] : []),
            "sep" as const,
          ]).concat([{ label: "Restablecer diseño", icon: <Settings2 className="size-3.5" />, onSelect: () => void saveLayout.run(DEFAULT_LAYOUT) }])}
        />
      </div>
      {order.filter((w) => w.visible).map((w) => (
        <React.Fragment key={w.id}>{blocks[w.id as WidgetId]}</React.Fragment>
      ))}
    </div>
  );
}

function BriefAndActions({ brief, loading, actions, previousVisit }: { brief?: Awaited<ReturnType<typeof buildDailyBrief>>; loading: boolean; actions?: ReturnType<typeof topActions>; previousVisit: string | null }) {
  const nav = useNavigate();
  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
      <Card>
        <CardHeader title="Daily Brief" icon={<ActivityIcon className="size-4 text-accent" />} subtitle={previousVisit ? `Esto cambió desde tu última visita (${relTime(previousVisit)})` : "Primera visita: mostrando las últimas 24 horas"} actions={<Button size="sm" variant="ghost" onClick={() => nav("/activity")}>Ver actividad</Button>} />
        <div className="px-4 pb-4">
          {loading || !brief ? (
            <Skeleton className="h-20" />
          ) : brief.empty ? (
            <p className="rounded-lg bg-surface-2 px-3 py-3 text-[12.5px] text-ink-2">No hay información nueva desde tu última visita. Los datos se actualizan al sincronizar integraciones o al registrar movimientos.</p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {brief.lines.map((l, i) => (
                  <li key={i} className="flex gap-2 text-[13px]">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                    {l}
                  </li>
                ))}
              </ul>
              {brief.events.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-line pt-3">
                  {brief.events.slice(0, 5).map((e) => (
                    <p key={e.id} className="flex justify-between gap-3 text-[12px] text-ink-2">
                      <span className="truncate">{e.title}</span>
                      <span className="shrink-0 text-ink-3">{relTime(e.occurred_at)}</span>
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="Tus 3 prioridades de hoy" icon={<Sparkles className="size-4 text-accent" />} subtitle="Motor local de reglas · sin IA externa" actions={<Button size="sm" variant="ghost" onClick={() => nav("/ai")}>AI Insights</Button>} />
        <div className="space-y-1 px-2 pb-3">
          {!actions ? (
            <Skeleton className="m-2 h-24" />
          ) : !actions.length ? (
            <p className="px-2 pb-2 text-[12.5px] text-ink-3">Sin recomendaciones: no hay datos suficientes todavía.</p>
          ) : (
            actions.map((a, i) => (
              <button key={a.id} onClick={() => a.link && nav(a.link)} className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2">
                <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-fg">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{a.recommendation}</span>
                  <span className="block text-[12px] text-ink-3">{a.reason}</span>
                </span>
                <Badge tone={a.type === "hecho" ? "info" : a.type === "estimación" ? "accent" : "neutral"}>{a.type}</Badge>
              </button>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

function FinancialPanel({ txs, projects }: { txs: Parameters<typeof summarize>[0]; projects: Project[] }) {
  const app = useApp();
  const [preset, setPreset] = React.useState<RangePreset>("90d");
  const [custom, setCustom] = React.useState<DateRange>({ from: addDays(todayStr(), -60), to: todayStr() });
  const [mode, setMode] = React.useState<"time" | "project">("time");
  const [visible, setVisible] = React.useState<SeriesKey[]>(["income", "expenses", "profit"]);
  const currencies = bagCurrencies(Object.fromEntries(Object.keys(summarize(txs)).map((c) => [c, 1])));
  const [currency, setCurrency] = React.useState<string>(app.reportingCurrency);
  const cur = currencies.includes(currency) ? currency : currencies[0] ?? app.reportingCurrency;
  const range = rangeFor(preset, custom);
  const bucket = bucketFor(range);
  const data = buildSeries(txs, range, bucket, cur);
  const byProj = byProject(txs, range)
    .map((p) => ({ bucket: projects.find((x) => x.id === p.projectId)?.name ?? "Sin proyecto", income: p.summary[cur]?.netRevenue ?? 0, expenses: (p.summary[cur]?.operatingExpenses ?? 0) + (p.summary[cur]?.fees ?? 0), profit: p.summary[cur]?.operatingProfit ?? 0, investment: p.summary[cur]?.investment ?? 0 }))
    .filter((r) => r.income || r.expenses || r.investment)
    .sort((a, b) => b.profit - a.profit);
  const hasData = data.some((d) => d.income || d.expenses || d.investment);
  return (
    <Card>
      <CardHeader
        title="Finanzas"
        subtitle={`${RANGE_LABEL[preset]} · ${cur} · los montos de otras monedas no se suman`}
        actions={
          <>
            <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: "time", label: "Evolución" }, { value: "project", label: "Por proyecto" }]} />
            <Select value={cur} onChange={(e) => setCurrency(e.target.value)} className="w-24">
              {(currencies.length ? currencies : [app.reportingCurrency]).map((c) => <option key={c}>{c}</option>)}
            </Select>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
        <Segmented size="sm" value={preset} onChange={setPreset} options={(Object.keys(RANGE_LABEL) as RangePreset[]).map((p) => ({ value: p, label: RANGE_LABEL[p] }))} />
        {preset === "custom" && (
          <div className="flex items-center gap-1.5">
            <Input type="date" className="h-7 w-36" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="Desde" />
            <span className="text-ink-3">→</span>
            <Input type="date" className="h-7 w-36" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="Hasta" />
          </div>
        )}
        <div className="ml-auto flex gap-1">
          {(Object.keys(SERIES) as SeriesKey[]).map((s) => (
            <button key={s} onClick={() => setVisible((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]))} aria-pressed={visible.includes(s)} className={cx("flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11.5px]", visible.includes(s) ? "border-line bg-surface text-ink" : "border-transparent text-ink-3")}>
              <span className="size-2 rounded-sm" style={{ background: visible.includes(s) ? SERIES[s].color : "var(--line-strong)" }} />
              {SERIES[s].label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-2 pb-3">
        {!txs.length ? (
          <EmptyState compact icon={<Wallet />} title="Sin transacciones registradas" body="Registrá ingresos y gastos, importá un CSV o conectá Mercado Pago / Stripe. No se muestran cifras simuladas." action={<Button variant="primary" size="sm" onClick={() => app.openQuick("income")}>Registrar ingreso</Button>} />
        ) : mode === "time" ? (
          hasData ? <FinanceChart data={data} series={visible} currency={cur} bucket={bucket} /> : <p className="py-16 text-center text-[12.5px] text-ink-3">Sin movimientos en {cur} para este período.</p>
        ) : byProj.length ? (
          <FinanceChart data={byProj} series={visible} currency={cur} bucket="day" kind="bar" />
        ) : (
          <p className="py-16 text-center text-[12.5px] text-ink-3">Sin movimientos en {cur} para este período.</p>
        )}
      </div>
    </Card>
  );
}

function ProjectsSummary({ projects, txs, tasks, deploys }: { projects: Project[]; txs: Parameters<typeof summarize>[0]; tasks: ReturnType<typeof useTasks>["data"] & object; deploys: Awaited<ReturnType<typeof listDeployments>> }) {
  const nav = useNavigate();
  const app = useApp();
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("active");
  const [sort, setSort] = React.useState("activity");
  const range = { from: addDays(todayStr(), -29), to: todayStr() };
  const fin = byProject(txs, range);
  const finFor = (id: string) => fin.find((f) => f.projectId === id)?.summary ?? {};
  const list = projects
    .filter((p) => (status === "all" ? true : status === "active" ? p.status !== "archived" : p.status === status))
    .filter((p) => !q || `${p.name} ${p.category ?? ""} ${p.description ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "profit") {
        const pa = finFor(a.id)[app.reportingCurrency]?.operatingProfit ?? -Infinity;
        const pb = finFor(b.id)[app.reportingCurrency]?.operatingProfit ?? -Infinity;
        return pb - pa;
      }
      if (sort === "priority") return ["critical", "high", "medium", "low"].indexOf(a.priority) - ["critical", "high", "medium", "low"].indexOf(b.priority);
      return (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? "");
    });
  return (
    <Card>
      <CardHeader
        title="Proyectos"
        subtitle="Últimos 30 días · beneficio operativo por moneda"
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
              <Input className="h-7 w-44 pl-7" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar proyectos" />
            </div>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36" aria-label="Filtrar por estado">
              <option value="active">No archivados</option>
              <option value="all">Todos</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-40" aria-label="Ordenar">
              <option value="activity">Última actividad</option>
              <option value="profit">Beneficio ({app.reportingCurrency})</option>
              <option value="priority">Prioridad</option>
              <option value="name">Nombre</option>
            </Select>
          </>
        }
      />
      <div className="grid gap-3 px-4 pb-4 md:grid-cols-2 xl:grid-cols-3">
        {!list.length ? (
          <div className="col-span-full">
            <EmptyState compact icon={<FolderKanban />} title={projects.length ? "Ningún proyecto coincide" : "Todavía no registraste proyectos"} action={!projects.length && <Button variant="primary" size="sm" onClick={() => nav("/projects")}>Registrar proyectos</Button>} />
          </div>
        ) : (
          list.slice(0, 12).map((p) => {
            const f = finFor(p.id);
            const lastDeploy = deploys.find((d) => d.project_id === p.id);
            const next = (tasks ?? []).filter((t) => t.project_id === p.id && !["done", "canceled"].includes(t.status) && !t.parent_id).sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999"))[0];
            const curs = Object.keys(f);
            return (
              <button key={p.id} onClick={() => nav(`/projects/${p.id}`)} className="group flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-2/40">
                <div className="flex items-center gap-2.5">
                  <ProjectAvatar project={p} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold">{p.name}</p>
                    <p className="truncate text-[11.5px] text-ink-3">{p.category ?? "Sin categoría"} · actividad {relTime(p.last_activity_at)}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface-2/70 px-2.5 py-2 text-[11.5px]">
                  {(["netRevenue", "operatingExpenses", "operatingProfit"] as const).map((k) => (
                    <div key={k}>
                      <p className="text-ink-3">{{ netRevenue: "Ingresos", operatingExpenses: "Gastos", operatingProfit: "Beneficio" }[k]}</p>
                      {curs.length ? curs.map((c) => <p key={c} className={cx("tabular font-medium", k === "operatingProfit" && (f[c]?.[k] ?? 0) < 0 && "text-danger")}>{formatMoney(k === "operatingExpenses" ? (f[c]?.operatingExpenses ?? 0) + (f[c]?.fees ?? 0) : f[c]?.[k] ?? 0, c, { compact: true })}</p>) : <NoData />}
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 text-[11.5px] text-ink-3">
                  <Tip content={lastDeploy ? `${lastDeploy.provider} · ${lastDeploy.environment ?? ""} · ${relTime(lastDeploy.created_at_ext)}` : "Sin despliegues sincronizados"}>
                    <span className="flex items-center gap-1">
                      <span className={cx("size-1.5 rounded-full", !lastDeploy ? "bg-line-strong" : lastDeploy.status === "ready" ? "bg-success" : lastDeploy.status === "error" ? "bg-danger" : "bg-warning")} />
                      {lastDeploy ? `Deploy ${lastDeploy.status}` : "Sin deploys"}
                    </span>
                  </Tip>
                  <span className="flex min-w-0 items-center gap-1 truncate">
                    {next ? <><ArrowRight className="size-3 shrink-0" /><span className="truncate">{next.title}</span></> : "Sin próxima tarea"}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
      {list.length > 12 && (
        <div className="border-t border-line px-4 py-2 text-right">
          <Button size="sm" variant="ghost" onClick={() => nav("/projects")}>Ver los {list.length} proyectos</Button>
        </div>
      )}
    </Card>
  );
}

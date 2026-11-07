import * as React from "react";
import { Plus, Trash2, BarChart3 } from "lucide-react";
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, NoData, PageHeader, Segmented, Select, Skeleton } from "@/components/ui/primitives";
import { ProjectAvatar, SourceNote } from "@/components/common";
import { Sparkline } from "@/components/charts/FinanceChart";
import { useAction, useData } from "@/app/hooks";
import { useProjects, useTasks } from "@/app/queries";
import { listObservations, upsertObservations, deleteObservation } from "@/repos/metrics";
import { listDevItems, listDeployments } from "@/repos/dev";
import { listTransactions } from "@/repos/finance";
import { METRICS, GROUP_LABEL, groupsForType, metricDef, type MetricGroup } from "@/domain/metricsCatalog";
import { summarize } from "@/domain/finance";
import { formatMoney, parseAmount } from "@/domain/money";
import type { MetricObservation, Project } from "@/domain/types";
import { fmtDate, fmtNum, relTime } from "@/lib/format";
import { addDays, todayStr } from "@/lib/util";
import { connectorStates } from "@/integrations/runner";

function fmtValue(o: MetricObservation) {
  const d = metricDef(o.metric_key);
  if (d?.unit === "money" && o.currency) return formatMoney(o.value, o.currency);
  if (d?.unit === "percent") return `${fmtNum(o.value, 1)}%`;
  return fmtNum(o.value, 1);
}

export default function AnalyticsPage() {
  const projects = useProjects();
  const [scope, setScope] = React.useState<"project" | "category">("project");
  const [projectId, setProjectId] = React.useState("");
  const [group, setGroup] = React.useState<MetricGroup>("saas");
  const [adding, setAdding] = React.useState(false);
  const p = projects.data?.find((x) => x.id === projectId) ?? projects.data?.find((x) => x.status !== "archived") ?? null;
  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Cada métrica muestra fuente, período y fecha de actualización. Las no disponibles figuran como no conectadas, nunca como cero."
        actions={
          <>
            <Segmented value={scope} onChange={setScope} options={[{ value: "project", label: "Por proyecto" }, { value: "category", label: "Consolidado por categoría" }]} />
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Registrar métrica</Button>
          </>
        }
      />
      {projects.isLoading ? <Skeleton className="h-96" /> : !projects.data?.length ? (
        <Card><EmptyState icon={<BarChart3 />} title="Registrá proyectos para ver sus métricas" /></Card>
      ) : scope === "project" && p ? (
        <>
          <div className="mb-4 flex items-center gap-2">
            <Select className="w-64" value={p.id} onChange={(e) => setProjectId(e.target.value)} aria-label="Proyecto">
              {projects.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
            <span className="text-[12px] text-ink-3">Plantilla según tipo: {groupsForType(p.type).map((g) => GROUP_LABEL[g]).join(" + ")} + desarrollo</span>
          </div>
          <ProjectDashboard p={p} />
        </>
      ) : (
        <>
          <Segmented className="mb-4" value={group} onChange={setGroup} options={(Object.keys(GROUP_LABEL) as MetricGroup[]).map((g) => ({ value: g, label: GROUP_LABEL[g] }))} />
          <Consolidated group={group} projects={projects.data} />
        </>
      )}
      <MetricDialog open={adding} onClose={() => setAdding(false)} projectId={p?.id ?? ""} />
    </div>
  );
}

function MetricCards({ obs, keys, connected }: { obs: MetricObservation[]; keys: string[]; connected: Set<string> }) {
  const del = useAction((id: string) => deleteObservation(id));
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {keys.map((k) => {
        const d = metricDef(k)!;
        const list = obs.filter((o) => o.metric_key === k).sort((a, b) => a.period_end.localeCompare(b.period_end));
        const last = list[list.length - 1];
        const lastPeriod = last ? list.filter((o) => o.period_end === last.period_end) : [];
        const sourceConnected = d.sources.some((s) => s !== "manual" && connected.has(s));
        const daily = d.aggregation === "sum" && list.length > 1 && list.every((o) => o.period_start === o.period_end);
        const sum30 = daily ? list.filter((o) => o.period_end >= addDays(todayStr(), -29)).reduce((s, o) => s + o.value, 0) : null;
        return (
          <Card key={k} className="p-3.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11.5px] font-medium text-ink-3">{d.label}</p>
              {last?.is_manual && <Badge>manual</Badge>}
            </div>
            <div className="mt-1 text-[19px] font-semibold tabular">
              {!last ? <NoData kind={sourceConnected ? "no_data" : "not_connected"} /> : sum30 !== null ? fmtNum(sum30) : lastPeriod.map((o) => <div key={o.id}>{fmtValue(o)}</div>)}
            </div>
            {list.length > 2 && <Sparkline values={list.slice(-30).map((o) => o.value)} />}
            <p className="mt-1">
              {last ? <SourceNote source={last.source} period={sum30 !== null ? "últimos 30 días" : last.period_start === last.period_end ? fmtDate(last.period_end) : `${fmtDate(last.period_start)}–${fmtDate(last.period_end)}`} updated={relTime(last.recorded_at)} /> : <span className="text-[11px] text-ink-3">Fuentes posibles: {d.sources.join(", ")}</span>}
            </p>
            {last?.is_manual && <button className="mt-1 text-[11px] text-ink-3 hover:text-danger" onClick={() => void del.run(last.id)}><Trash2 className="mr-1 inline size-3" />Eliminar último registro</button>}
          </Card>
        );
      })}
    </div>
  );
}

function ProjectDashboard({ p }: { p: Project }) {
  const obs = useData(["metrics", p.id], () => listObservations({ projectId: p.id }));
  const states = useData(["integrations", "states"], connectorStates);
  const dev = useData(["dev_items", p.id, "90"], () => listDevItems({ projectId: p.id, since: addDays(todayStr(), -90), limit: 2000 }));
  const deploys = useData(["deployments", p.id], () => listDeployments({ projectId: p.id, limit: 200 }));
  const tasks = useTasks();
  const txs = useData(["transactions", "project", p.id, "90"], () => listTransactions({ projectId: p.id, from: addDays(todayStr(), -89) }));
  const connected = new Set((states.data ?? []).filter((s) => s.status === "connected").map((s) => s.def.id));
  const groups = groupsForType(p.type);
  const items = dev.data ?? [];
  const pt = (tasks.data ?? []).filter((t) => t.project_id === p.id && !t.parent_id);
  const hasDev = items.length > 0;
  const d90 = (deploys.data ?? []).filter((d) => d.created_at_ext >= addDays(todayStr(), -90));
  const fin = summarize(txs.data ?? []);
  const devCard = (label: string, value: React.ReactNode, note: string) => (
    <Card className="p-3.5">
      <p className="text-[11.5px] font-medium text-ink-3">{label}</p>
      <div className="mt-1 text-[19px] font-semibold tabular">{value}</div>
      <p className="mt-1 text-[11px] text-ink-3">{note}</p>
    </Card>
  );
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g}>
          <h2 className="mb-2 text-[13px] font-semibold text-ink-2">{GROUP_LABEL[g]}</h2>
          {obs.isLoading ? <Skeleton className="h-28" /> : <MetricCards obs={obs.data ?? []} keys={METRICS.filter((m) => m.group === g).map((m) => m.key)} connected={connected} />}
        </section>
      ))}
      {groups.includes("ecommerce") && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold text-ink-2">Ventas (desde transacciones, 90 días)</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {devCard("Ventas netas", Object.keys(fin).length ? Object.entries(fin).map(([c, b]) => <div key={c}>{formatMoney(b.netRevenue, c)}</div>) : <NoData />, "Fuente: transacciones registradas")}
            {devCard("Reembolsos", Object.keys(fin).length ? Object.entries(fin).map(([c, b]) => <div key={c}>{formatMoney(b.refunds, c)}</div>) : <NoData />, "Fuente: transacciones registradas")}
            {devCard("Ticket promedio", (() => { const inc = (txs.data ?? []).filter((t) => t.kind === "income"); if (!inc.length) return <NoData />; const byC: Record<string, number[]> = {}; inc.forEach((t) => (byC[t.currency] ??= []).push(t.amount_minor)); return Object.entries(byC).map(([c, v]) => <div key={c}>{formatMoney(Math.round(v.reduce((a, b) => a + b, 0) / v.length), c)}</div>); })(), "Ingresos / cantidad de ventas registradas")}
          </div>
        </section>
      )}
      <section>
        <h2 className="mb-2 text-[13px] font-semibold text-ink-2">Desarrollo (90 días)</h2>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {devCard("Issues abiertas", hasDev ? items.filter((i) => i.kind === "issue" && i.state === "open").length : <NoData kind="not_connected" />, "GitHub")}
          {devCard("Issues resueltas", hasDev ? items.filter((i) => i.kind === "issue" && i.state === "closed").length : <NoData kind="not_connected" />, "GitHub")}
          {devCard("PRs fusionados", hasDev ? items.filter((i) => i.kind === "pull_request" && i.state === "merged").length : <NoData kind="not_connected" />, "GitHub")}
          {devCard("Fallos de CI", hasDev ? items.filter((i) => i.kind === "workflow_run" && i.state === "failure").length : <NoData kind="not_connected" />, "GitHub Actions")}
          {devCard("Deploys exitosos", d90.length ? d90.filter((d) => d.status === "ready").length : <NoData kind="not_connected" />, "Vercel / Netlify")}
          {devCard("Hitos completados", pt.length ? `${pt.filter((t) => t.status === "done").length}/${pt.length}` : <NoData />, p.target_launch_on ? `Lanzamiento en ${Math.max(0, Math.round((Date.parse(p.target_launch_on) - Date.now()) / 86400000))} d` : "Tareas del roadmap")}
        </div>
      </section>
    </div>
  );
}

function Consolidated({ group, projects }: { group: MetricGroup; projects: Project[] }) {
  const obs = useData(["metrics", "all"], () => listObservations());
  const keys = METRICS.filter((m) => m.group === group);
  const relevant = projects.filter((p) => groupsForType(p.type).includes(group) && p.status !== "archived");
  if (obs.isLoading) return <Skeleton className="h-72" />;
  return (
    <Card className="overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>Proyecto</th>{keys.map((k) => <th key={k.key} className="text-right">{k.label}</th>)}</tr></thead>
        <tbody>
          {!relevant.length && <tr><td colSpan={keys.length + 1} className="py-8 text-center text-ink-3">Ningún proyecto de esta categoría.</td></tr>}
          {relevant.map((p) => (
            <tr key={p.id}>
              <td><span className="flex items-center gap-2"><ProjectAvatar project={p} size={20} />{p.name}</span></td>
              {keys.map((k) => {
                const list = (obs.data ?? []).filter((o) => o.project_id === p.id && o.metric_key === k.key).sort((a, b) => b.period_end.localeCompare(a.period_end));
                return <td key={k.key} className="text-right tabular">{list[0] ? <span title={`${list[0].source} · ${list[0].period_end}`}>{fmtValue(list[0])}</span> : <span className="text-[11.5px] text-ink-3">—</span>}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-3">Último valor registrado por proyecto. “—” = sin datos o fuente no conectada. Pasá el cursor para ver fuente y período.</p>
    </Card>
  );
}

function MetricDialog({ open, onClose, projectId: initial }: { open: boolean; onClose: () => void; projectId: string }) {
  const projects = useProjects();
  const [f, setF] = React.useState({ project_id: initial, metric_key: "active_users", value: "", currency: "USD", from: todayStr(), to: todayStr() });
  React.useEffect(() => { if (open) setF((s) => ({ ...s, project_id: initial, value: "" })); }, [open, initial]);
  const d = metricDef(f.metric_key);
  const save = useAction(async () => {
    const v = parseAmount(f.value);
    if (!isFinite(v)) throw new Error("Valor inválido");
    await upsertObservations([{ project_id: f.project_id || null, metric_key: f.metric_key, value: d?.unit === "money" ? Math.round(v * 100) : v, unit: d?.unit ?? "count", currency: d?.unit === "money" ? f.currency : null, period_start: f.from, period_end: f.to, source: "manual", is_manual: true }]);
  }, { success: "Métrica registrada" });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Registrar métrica manual" description="Para fuentes sin integración. Queda marcada como dato manual con su período." footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!f.value} onClick={async () => (await save.run(), onClose())}>Guardar</Button></>}>
      <div className="grid grid-cols-2 gap-3 pb-3">
        <Field label="Proyecto"><Select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Métrica"><Select value={f.metric_key} onChange={(e) => setF({ ...f, metric_key: e.target.value })}>{(Object.keys(GROUP_LABEL) as MetricGroup[]).map((g) => <optgroup key={g} label={GROUP_LABEL[g]}>{METRICS.filter((m) => m.group === g).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</optgroup>)}</Select></Field>
        <Field label={`Valor${d?.unit === "percent" ? " (%)" : ""}`} hint={d?.description}><Input value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} inputMode="decimal" /></Field>
        {d?.unit === "money" ? <Field label="Moneda"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option>USD</option><option>ARS</option></Select></Field> : <div />}
        <Field label="Período desde"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="hasta"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

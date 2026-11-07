import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Code2, ExternalLink, FolderOpen, GitBranch, Link2, Pencil, Plus, Trash2, Lightbulb, Flag, CheckCircle2, Circle } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, InfoTip, Menu, NoData, Progress, Select, Skeleton, Tabs, Tip } from "@/components/ui/primitives";
import { MoneyBagView, ProjectAvatar, StatusBadge, SeverityBadge, Stat } from "@/components/common";
import { useApp } from "@/app/AppContext";
import { useAction, useData } from "@/app/hooks";
import { useMilestones, useTasks } from "@/app/queries";
import { addLink, deleteLink, getProject, listLinks, listRepositories, updateProject } from "@/repos/projects";
import { listTransactions, listRecurring } from "@/repos/finance";
import { listDeployments, listDevItems, listHealthChecks } from "@/repos/dev";
import { listCampaigns } from "@/repos/marketing";
import { listObservations } from "@/repos/metrics";
import { listAlerts } from "@/repos/alerts";
import { listIntegrationRows } from "@/repos/integrations";
import { saveMilestone, deleteMilestone, updateTask } from "@/repos/tasks";
import { summarize, pick, roi, monthlyEquivalent } from "@/domain/finance";
import { buildScorecard } from "@/domain/scorecard";
import { LINK_KINDS, LINK_LABEL, PRIORITY_LABEL, PROJECT_STATUSES, STATUS_LABEL, TYPE_LABEL, TASK_STATUS_LABEL, type LinkKind, type Project, type ProjectStatus } from "@/domain/types";
import { formatMoney } from "@/domain/money";
import { fmtDate, relTime, fmtPct } from "@/lib/format";
import { addDays, daysBetween, todayStr, cx } from "@/lib/util";
import { openInEditor, openUrl, revealPath } from "@/platform/files";
import { isNative } from "@/platform/runtime";
import { ProjectDialog } from "./ProjectDialog";
import { useToast } from "@/components/ui/feedback";
import { CONNECTOR_NAMES } from "@/integrations/names";

type Tab = "summary" | "tech" | "dev" | "business" | "ops" | "roadmap" | "scorecard";

export default function ProjectDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const project = useData(["project", id], () => getProject(id));
  const [tab, setTab] = React.useState<Tab>("summary");
  const [editing, setEditing] = React.useState(false);
  const p = project.data;
  if (project.isLoading) return <Skeleton className="mt-6 h-96" />;
  if (!p) return <EmptyState title="Proyecto no encontrado" action={<Button onClick={() => nav("/projects")}>Volver a proyectos</Button>} />;
  return (
    <div>
      <button onClick={() => nav("/projects")} className="mb-3 flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" /> Projects
      </button>
      <Header p={p} onEdit={() => setEditing(true)} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "summary", label: "Resumen" }, { value: "tech", label: "Tecnología" }, { value: "dev", label: "Desarrollo" }, { value: "business", label: "Negocio" }, { value: "ops", label: "Operaciones" }, { value: "roadmap", label: "Roadmap" }, { value: "scorecard", label: "Scorecard" }]} />
      {tab === "summary" && <Summary p={p} />}
      {tab === "tech" && <Tech p={p} />}
      {tab === "dev" && <Dev p={p} />}
      {tab === "business" && <Business p={p} />}
      {tab === "ops" && <Ops p={p} />}
      {tab === "roadmap" && <Roadmap p={p} />}
      {tab === "scorecard" && <ScorecardTab p={p} />}
      <ProjectDialog open={editing} project={p} onClose={() => setEditing(false)} />
    </div>
  );
}

function useStatusSuggestion(p: Project) {
  const deploys = useData(["deployments", p.id], () => listDeployments({ projectId: p.id, limit: 20 }));
  const txs = useData(["transactions", "project", p.id], () => listTransactions({ projectId: p.id, from: addDays(todayStr(), -90) }));
  const pre: ProjectStatus[] = ["idea", "research", "design", "planning", "development", "testing", "beta"];
  const prod = (deploys.data ?? []).find((d) => d.environment === "production" && d.status === "ready");
  const hasIncome = (txs.data ?? []).some((t) => t.kind === "income");
  if (pre.includes(p.status) && (prod || hasIncome))
    return { to: "launched" as ProjectStatus, reasons: [prod ? `Deploy en producción listo (${relTime(prod.created_at_ext)}); un deploy exitoso no garantiza salud` : null, hasIncome ? "Tiene ingresos registrados en los últimos 90 días" : null].filter(Boolean) as string[] };
  const days = p.last_activity_at ? daysBetween(p.last_activity_at.slice(0, 10), todayStr()) : null;
  if (["research", "design", "planning", "development", "testing", "beta"].includes(p.status) && days !== null && days > 90)
    return { to: "paused" as ProjectStatus, reasons: [`Sin actividad registrada hace ${days} días`] };
  return null;
}

function Header({ p, onEdit }: { p: Project; onEdit: () => void }) {
  const links = useData(["links", p.id], () => listLinks(p.id));
  const repos = useData(["repositories"], listRepositories);
  const setStatus = useAction((s: ProjectStatus) => updateProject(p.id, { status: s }), { success: "Estado actualizado" });
  const suggestion = useStatusSuggestion(p);
  const toast = useToast();
  const repo = (repos.data ?? []).find((r) => r.project_id === p.id && r.html_url);
  const localPath = p.local_path ?? (repos.data ?? []).find((r) => r.project_id === p.id && r.local_path)?.local_path ?? null;
  const safe = (fn: () => Promise<unknown>) => () => fn().catch((e: Error) => toast.show({ title: "No se pudo abrir", body: e.message, tone: "danger" }));
  const deep = [
    repo?.html_url && { label: "Repositorio", icon: <GitBranch className="size-3.5" />, run: safe(() => openUrl(repo.html_url!)) },
    localPath && isNative() && { label: "Finder", icon: <FolderOpen className="size-3.5" />, run: safe(() => revealPath(localPath)) },
    localPath && isNative() && { label: "VS Code", icon: <Code2 className="size-3.5" />, run: safe(() => openInEditor(localPath)) },
    p.docs_url && { label: "Docs", icon: <ExternalLink className="size-3.5" />, run: safe(() => openUrl(p.docs_url!)) },
    ...(links.data ?? []).filter((l) => ["production", "admin", "provider", "staging"].includes(l.kind)).map((l) => ({ label: l.label ?? LINK_LABEL[l.kind], icon: <ExternalLink className="size-3.5" />, run: safe(() => openUrl(l.url)) })),
  ].filter(Boolean) as Array<{ label: string; icon: React.ReactNode; run: () => void }>;
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-start gap-4">
        <ProjectAvatar project={p} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{p.name}</h1>
            <StatusBadge status={p.status} />
            <Badge>{TYPE_LABEL[p.type]}</Badge>
            <Badge tone={p.priority === "critical" ? "danger" : p.priority === "high" ? "warning" : "neutral"}>Prioridad {PRIORITY_LABEL[p.priority].toLowerCase()}</Badge>
          </div>
          <p className="mt-1 max-w-3xl text-[13px] text-ink-2">{p.description ?? "Sin descripción."}</p>
          <p className="mt-1 text-[12px] text-ink-3">
            {p.category ?? "Sin categoría"} · creado {fmtDate(p.created_at)} · última actividad {relTime(p.last_activity_at)}
            {p.target_launch_on ? ` · lanzamiento objetivo ${fmtDate(p.target_launch_on)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={p.status} onChange={(e) => void setStatus.run(e.target.value as ProjectStatus)} className="w-36" aria-label="Cambiar estado">
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
          <Button icon={<Pencil className="size-3.5" />} onClick={onEdit}>Editar</Button>
        </div>
      </div>
      {deep.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {deep.map((d) => (
            <Button key={d.label} size="sm" variant="subtle" icon={d.icon} onClick={d.run}>{d.label}</Button>
          ))}
        </div>
      )}
      {suggestion && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-[12.5px]">
          <Lightbulb className="size-4 text-info" />
          <span className="flex-1">Sugerencia basada en evidencia: cambiar a <b>{STATUS_LABEL[suggestion.to]}</b> — {suggestion.reasons.join(" · ")}</span>
          <Button size="xs" variant="primary" onClick={() => void setStatus.run(suggestion.to)}>Aplicar</Button>
        </div>
      )}
    </div>
  );
}

function Summary({ p }: { p: Project }) {
  const txs = useData(["transactions", "project", p.id, "all"], () => listTransactions({ projectId: p.id }));
  const tasks = useTasks();
  const ms = useMilestones();
  const r90 = { from: addDays(todayStr(), -89), to: todayStr() };
  const s90 = summarize(txs.data ?? [], r90);
  const all = summarize(txs.data ?? []);
  const pt = (tasks.data ?? []).filter((t) => t.project_id === p.id && !t.parent_id && t.status !== "canceled");
  const done = pt.filter((t) => t.status === "done").length;
  const milestones = (ms.data ?? []).filter((m) => m.project_id === p.id);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Ingresos netos (90 d)" value={<MoneyBagView bag={pick(s90, "netRevenue")} compact />} />
        <Stat label="Beneficio operativo (90 d)" value={<MoneyBagView bag={pick(s90, "operatingProfit")} compact signed />} />
        <Stat label="Inversión acumulada" value={<MoneyBagView bag={pick(all, "investment")} compact />} />
        <Stat label="Progreso del roadmap" value={pt.length ? `${done}/${pt.length}` : <NoData />} sub={pt.length ? <Progress value={(done / pt.length) * 100} /> : "Definí tareas o hitos para medir avance"} hint="Basado en tareas completadas, no en commits" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Información general" />
          <dl className="grid grid-cols-[150px_1fr] gap-y-2 px-4 pb-4 text-[12.5px]">
            <dt className="text-ink-3">Monetización</dt><dd>{p.monetization_model ?? <NoData />}</dd>
            <dt className="text-ink-3">Hosting</dt><dd>{p.hosting ?? <NoData />}</dd>
            <dt className="text-ink-3">Dominio</dt><dd>{p.domain ?? <NoData />}</dd>
            <dt className="text-ink-3">Fuente</dt><dd>{p.source === "discovery" ? "Descubrimiento local" : p.source === "demo" ? "Demo" : "Manual"}</dd>
            <dt className="text-ink-3">Notas</dt><dd className="whitespace-pre-wrap selectable">{p.notes ?? <NoData />}</dd>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Hitos" icon={<Flag className="size-4 text-ink-3" />} />
          <div className="px-4 pb-4">
            {!milestones.length ? (
              <p className="text-[12.5px] text-ink-3">Sin hitos. Crealos en la pestaña Roadmap.</p>
            ) : (
              milestones.map((m) => {
                const mt = pt.filter((t) => t.milestone_id === m.id);
                const md = mt.filter((t) => t.status === "done").length;
                return (
                  <div key={m.id} className="py-1.5">
                    <div className="mb-1 flex justify-between text-[12.5px]">
                      <span className="font-medium">{m.title}</span>
                      <span className="text-ink-3">{mt.length ? `${md}/${mt.length}` : "sin tareas"}{m.due_on ? ` · ${fmtDate(m.due_on)}` : ""}</span>
                    </div>
                    <Progress value={mt.length ? (md / mt.length) * 100 : m.status === "done" ? 100 : 0} />
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>
      <LinksCard p={p} />
    </div>
  );
}

function LinksCard({ p }: { p: Project }) {
  const links = useData(["links", p.id], () => listLinks(p.id));
  const [kind, setKind] = React.useState<LinkKind>("production");
  const [url, setUrl] = React.useState("");
  const add = useAction(async () => addLink(p.id, kind, url), { success: "Enlace agregado" });
  const del = useAction((id: string) => deleteLink(id));
  return (
    <Card>
      <CardHeader title="Enlaces" icon={<Link2 className="size-4 text-ink-3" />} subtitle="Producción, admin, panel del proveedor, diseño…" />
      <div className="px-4 pb-4">
        <ul className="mb-3 divide-y divide-line">
          {(links.data ?? []).map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-1.5 text-[12.5px]">
              <Badge>{LINK_LABEL[l.kind]}</Badge>
              <button className="flex-1 truncate text-left text-accent hover:underline" onClick={() => void openUrl(l.url)}>{l.url}</button>
              <Button size="xs" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label="Eliminar enlace" onClick={() => void del.run(l.id)} />
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Select value={kind} onChange={(e) => setKind(e.target.value as LinkKind)} className="w-44">
            {LINK_KINDS.map((k) => <option key={k} value={k}>{LINK_LABEL[k]}</option>)}
          </Select>
          <Input placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button icon={<Plus className="size-3.5" />} disabled={!url} onClick={async () => (await add.run(), setUrl(""))}>Agregar</Button>
        </div>
      </div>
    </Card>
  );
}

function Tech({ p }: { p: Project }) {
  const repos = useData(["repositories"], listRepositories);
  const mine = (repos.data ?? []).filter((r) => r.project_id === p.id);
  const row = (label: string, v: React.ReactNode) => (
    <>
      <dt className="text-ink-3">{label}</dt>
      <dd>{v}</dd>
    </>
  );
  const chips = (xs: string[]) => (xs.length ? <div className="flex flex-wrap gap-1">{xs.map((x) => <Badge key={x}>{x}</Badge>)}</div> : <NoData />);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Stack" />
        <dl className="grid grid-cols-[150px_1fr] gap-y-2.5 px-4 pb-4 text-[12.5px]">
          {row("Lenguajes", chips(p.languages))}
          {row("Frameworks", chips(p.frameworks))}
          {row("Base de datos", p.database_tech ?? <NoData />)}
          {row("Hosting", p.hosting ?? <NoData />)}
          {row("Entornos", chips(p.environments))}
          {row("Dependencias", chips(p.dependencies))}
          {row("Carpeta local", p.local_path ? <span className="font-mono text-[11.5px] selectable">{p.local_path}</span> : <NoData />)}
          {row("Arquitectura", p.architecture ? <span className="whitespace-pre-wrap selectable">{p.architecture}</span> : <NoData />)}
        </dl>
      </Card>
      <Card>
        <CardHeader title="Repositorios" subtitle="Vinculados por descubrimiento local o GitHub" />
        <div className="px-4 pb-4">
          {!mine.length ? (
            <p className="text-[12.5px] text-ink-3">Sin repositorios vinculados. Usá Descubrir o vinculalo en Integrations → GitHub → Mapeo.</p>
          ) : (
            mine.map((r) => (
              <div key={r.id} className="border-b border-line py-2 last:border-0">
                <p className="flex items-center gap-1.5 text-[13px] font-medium"><GitBranch className="size-3.5 text-ink-3" />{r.full_name ?? r.canonical_key}</p>
                <p className="text-[12px] text-ink-3">
                  {r.default_branch ? `rama ${r.default_branch} · ` : ""}
                  {r.last_commit_at ? `último commit ${relTime(r.last_commit_at)}` : "último commit sin datos"}
                  {r.open_prs != null ? ` · ${r.open_prs} PRs abiertos` : ""}
                  {r.open_issues != null ? ` · ${r.open_issues} issues` : ""}
                </p>
                {r.last_commit_message && <p className="truncate text-[12px] text-ink-2">“{r.last_commit_message}”</p>}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

function Dev({ p }: { p: Project }) {
  const items = useData(["dev_items", p.id], () => listDevItems({ projectId: p.id, limit: 60 }));
  const deploys = useData(["deployments", p.id], () => listDeployments({ projectId: p.id, limit: 15 }));
  const openIssues = (items.data ?? []).filter((i) => i.kind === "issue" && i.state === "open");
  const openPrs = (items.data ?? []).filter((i) => i.kind === "pull_request" && i.state === "open");
  const failed = (items.data ?? []).filter((i) => i.kind === "workflow_run" && i.state === "failure");
  const lastCommit = (items.data ?? []).find((i) => i.kind === "commit");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Último commit" value={lastCommit ? relTime(lastCommit.created_at_ext) : <NoData kind="not_connected" />} sub={lastCommit?.title} />
        <Stat label="Issues abiertas (sincronizadas)" value={items.data?.length ? openIssues.length : <NoData kind="not_connected" />} />
        <Stat label="PRs abiertos" value={items.data?.length ? openPrs.length : <NoData kind="not_connected" />} />
        <Stat label="Workflows fallidos (recientes)" value={items.data?.length ? failed.length : <NoData kind="not_connected" />} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Actividad reciente" subtitle="Commits, PRs, issues, releases y workflows" />
          <ul className="max-h-96 overflow-y-auto px-4 pb-4">
            {!(items.data ?? []).length && <p className="text-[12.5px] text-ink-3">Sin datos. Vinculá un repositorio de GitHub a este proyecto y sincronizá.</p>}
            {(items.data ?? []).slice(0, 40).map((i) => (
              <li key={i.id} className="flex items-center gap-2 border-b border-line py-1.5 text-[12.5px] last:border-0">
                <Badge tone={i.state === "failure" ? "danger" : i.state === "merged" ? "accent" : "neutral"}>{{ commit: "commit", issue: "issue", pull_request: "PR", release: "release", workflow_run: "CI" }[i.kind]}</Badge>
                <button className="flex-1 truncate text-left hover:underline" onClick={() => i.url && void openUrl(i.url)}>{i.number ? `#${i.number} ` : ""}{i.title}</button>
                <span className="shrink-0 text-[11.5px] text-ink-3">{relTime(i.updated_at_ext ?? i.created_at_ext)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Despliegues" subtitle="Un deploy exitoso no implica que la app esté saludable" />
          <ul className="px-4 pb-4">
            {!(deploys.data ?? []).length && <p className="text-[12.5px] text-ink-3">Sin despliegues. Conectá Vercel o Netlify y vinculá el proyecto.</p>}
            {(deploys.data ?? []).map((d) => (
              <li key={d.id} className="flex items-center gap-2 border-b border-line py-1.5 text-[12.5px] last:border-0">
                <Badge tone={d.status === "ready" ? "success" : d.status === "error" ? "danger" : "warning"}>{d.status}</Badge>
                <span className="text-ink-2">{d.provider} · {d.environment}</span>
                <span className="flex-1 truncate text-ink-3">{d.commit_message ?? d.branch ?? ""}</span>
                <span className="shrink-0 text-[11.5px] text-ink-3">{relTime(d.created_at_ext)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Business({ p }: { p: Project }) {
  const txs = useData(["transactions", "project", p.id, "all"], () => listTransactions({ projectId: p.id }));
  const recurring = useData(["recurring"], listRecurring);
  const camps = useData(["campaigns"], listCampaigns);
  const metrics = useData(["metrics", p.id], () => listObservations({ projectId: p.id }));
  const app = useApp();
  const all = summarize(txs.data ?? []);
  const m30 = summarize(txs.data ?? [], { from: addDays(todayStr(), -29), to: todayStr() });
  const latest = (key: string) => [...(metrics.data ?? [])].filter((o) => o.metric_key === key).sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
  const mrr = (metrics.data ?? []).filter((o) => o.metric_key === "mrr");
  const mrrLatest = mrr.length ? mrr.filter((o) => o.period_end === mrr.sort((a, b) => b.period_end.localeCompare(a.period_end))[0].period_end) : [];
  const subs = latest("active_subscriptions");
  const rec = (recurring.data ?? []).filter((r) => r.project_id === p.id && r.active);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Ingresos netos (30 d)" value={<MoneyBagView bag={pick(m30, "netRevenue")} compact />} />
        <Stat label="Gastos + comisiones (30 d)" value={<MoneyBagView bag={Object.fromEntries(Object.entries(m30).map(([c, b]) => [c, b.operatingExpenses + b.fees]).filter(([, v]) => v))} compact />} />
        <Stat label="MRR" value={mrrLatest.length ? <span className="flex flex-col">{mrrLatest.map((o) => <span key={o.id}>{formatMoney(o.value, o.currency ?? "USD", { compact: true })}</span>)}</span> : <NoData kind="not_connected" />} sub={mrrLatest[0] ? `${mrrLatest[0].source} · ${mrrLatest[0].period_end}` : "Requiere Stripe o carga manual"} />
        <Stat label="Suscriptores activos" value={subs ? subs.value : <NoData kind="not_connected" />} sub={subs ? `${subs.source} · ${subs.period_end}` : undefined} />
      </div>
      <Card>
        <CardHeader title="Rentabilidad acumulada" subtitle="Todas las transacciones registradas del proyecto, por moneda" actions={<Button size="sm" onClick={() => app.openQuick("income", { project_id: p.id })}>Registrar movimiento</Button>} />
        {!Object.keys(all).length ? (
          <EmptyState compact title="Sin transacciones" body="Ingresos, gastos y ROI se calculan desde transacciones registradas o sincronizadas." />
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Moneda</th><th className="text-right">Ingresos netos</th><th className="text-right">Comisiones</th><th className="text-right">Gastos operativos</th><th className="text-right">Publicidad</th><th className="text-right">Beneficio operativo</th><th className="text-right">Inversión</th><th className="text-right">ROI <InfoTip content="(ingresos netos − comisiones − gastos − inversión) / (comisiones + gastos + inversión)" /></th></tr>
            </thead>
            <tbody>
              {Object.entries(all).map(([c, b]) => (
                <tr key={c}>
                  <td className="font-medium">{c}</td>
                  <td className="text-right tabular">{formatMoney(b.netRevenue, c)}</td>
                  <td className="text-right tabular">{formatMoney(b.fees, c)}</td>
                  <td className="text-right tabular">{formatMoney(b.operatingExpenses, c)}</td>
                  <td className="text-right tabular">{formatMoney(b.adSpend, c)}</td>
                  <td className={cx("text-right tabular font-medium", b.operatingProfit < 0 && "text-danger")}>{formatMoney(b.operatingProfit, c)}</td>
                  <td className="text-right tabular">{formatMoney(b.investment, c)}</td>
                  <td className="text-right tabular">{roi(b) === null ? "—" : fmtPct(roi(b)! * 100, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Costos recurrentes" />
          <ul className="px-4 pb-4 text-[12.5px]">
            {!rec.length && <p className="text-ink-3">Sin costos recurrentes asociados.</p>}
            {rec.map((r) => (
              <li key={r.id} className="flex justify-between border-b border-line py-1.5 last:border-0">
                <span>{r.name}</span>
                <span className="tabular text-ink-2">{formatMoney(monthlyEquivalent(r.amount_minor, r.interval), r.currency)}/mes</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Publicidad" />
          <ul className="px-4 pb-4 text-[12.5px]">
            {!(camps.data ?? []).filter((c) => c.project_id === p.id).length && <p className="text-ink-3">Sin campañas asociadas.</p>}
            {(camps.data ?? []).filter((c) => c.project_id === p.id).map((c) => (
              <li key={c.id} className="flex justify-between border-b border-line py-1.5 last:border-0">
                <span>{c.name}</span>
                <Badge tone={/active/i.test(c.status) ? "success" : "neutral"}>{c.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {(p.monetization_model || p.pricing_notes) && (
        <Card>
          <CardHeader title="Modelo y planes" />
          <div className="whitespace-pre-wrap px-4 pb-4 text-[12.5px] selectable">{p.monetization_model}{p.pricing_notes ? `\n${p.pricing_notes}` : ""}</div>
        </Card>
      )}
    </div>
  );
}

function Ops({ p }: { p: Project }) {
  const recurring = useData(["recurring"], listRecurring);
  const checks = useData(["health_checks"], listHealthChecks);
  const alerts = useData(["alerts", "open"], () => listAlerts("open"));
  const integ = useData(["integrations", "rows"], listIntegrationRows);
  const next = (recurring.data ?? []).filter((r) => r.project_id === p.id && r.active && r.next_due_on).sort((a, b) => a.next_due_on!.localeCompare(b.next_due_on!));
  const mine = (checks.data ?? []).filter((c) => c.project_id === p.id);
  const nav = useNavigate();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Estado operativo" />
        <dl className="grid grid-cols-[160px_1fr] gap-y-2 px-4 pb-4 text-[12.5px]">
          <dt className="text-ink-3">Dominio</dt><dd>{p.domain ?? <NoData />}</dd>
          <dt className="text-ink-3">Health checks</dt><dd>{mine.length ? `${mine.length} configurados` : <span className="text-ink-3">Ninguno · <button className="text-accent" onClick={() => nav("/development?tab=monitoring")}>agregar</button></span>}</dd>
          <dt className="text-ink-3">Última sincronización</dt>
          <dd>{(integ.data ?? []).filter((i) => i.last_success_at).map((i) => <div key={i.id}>{CONNECTOR_NAMES[i.id] ?? i.id}: {relTime(i.last_success_at)}{i.status === "error" && <span className="text-warning"> · con error, datos posiblemente desactualizados</span>}</div>)}{!(integ.data ?? []).some((i) => i.last_success_at) && <NoData kind="not_connected" />}</dd>
        </dl>
      </Card>
      <Card>
        <CardHeader title="Próximos vencimientos" />
        <ul className="px-4 pb-4 text-[12.5px]">
          {!next.length && <p className="text-ink-3">Sin vencimientos registrados.</p>}
          {next.map((r) => (
            <li key={r.id} className="flex justify-between border-b border-line py-1.5 last:border-0">
              <span>{r.name}</span>
              <span className="text-ink-2">{fmtDate(r.next_due_on)} · {formatMoney(r.amount_minor, r.currency)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Alertas del proyecto" />
        <ul className="px-4 pb-4">
          {!(alerts.data ?? []).filter((a) => a.project_id === p.id).length && <p className="text-[12.5px] text-ink-3">Sin alertas abiertas.</p>}
          {(alerts.data ?? []).filter((a) => a.project_id === p.id).map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-1.5 text-[12.5px]"><SeverityBadge severity={a.severity} />{a.title}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Roadmap({ p }: { p: Project }) {
  const app = useApp();
  const tasks = useTasks();
  const ms = useMilestones();
  const [title, setTitle] = React.useState("");
  const [due, setDue] = React.useState("");
  const add = useAction(() => saveMilestone({ project_id: p.id, title, due_on: due || null }), { success: "Hito creado" });
  const setMs = useAction((id: string, status: "planned" | "active" | "done") => {
    const m = (ms.data ?? []).find((x) => x.id === id)!;
    return saveMilestone({ project_id: m.project_id, title: m.title, description: m.description, due_on: m.due_on, status }, id);
  });
  const delMs = useAction((id: string) => deleteMilestone(id));
  const toggle = useAction((id: string, done: boolean) => updateTask(id, { status: done ? "done" : "todo" }));
  const pt = (tasks.data ?? []).filter((t) => t.project_id === p.id && !t.parent_id && t.status !== "canceled");
  const milestones = (ms.data ?? []).filter((m) => m.project_id === p.id);
  const groups = [...milestones.map((m) => ({ m, list: pt.filter((t) => t.milestone_id === m.id) })), { m: null, list: pt.filter((t) => !t.milestone_id || !milestones.some((m) => m.id === t.milestone_id)) }];
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Nuevo hito" className="min-w-60 flex-1"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="p. ej. MVP público" /></Field>
          <Field label="Fecha"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Button icon={<Plus className="size-3.5" />} disabled={!title.trim()} onClick={async () => (await add.run(), setTitle(""), setDue(""))}>Crear hito</Button>
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => app.openQuick("task", { project_id: p.id })}>Nueva tarea</Button>
        </div>
      </Card>
      {groups.map(({ m, list }) =>
        !m && !list.length ? null : (
          <Card key={m?.id ?? "none"}>
            <CardHeader
              title={m ? m.title : "Sin hito"}
              icon={<Flag className={cx("size-4", m?.status === "done" ? "text-success" : "text-ink-3")} />}
              subtitle={m ? `${list.filter((t) => t.status === "done").length}/${list.length} tareas${m.due_on ? ` · vence ${fmtDate(m.due_on)}` : ""}` : `${list.length} tareas`}
              actions={m && (
                <Menu trigger={<Button size="xs" variant="ghost">{{ planned: "Planificado", active: "Activo", done: "Completado", canceled: "Cancelado" }[m.status]}</Button>} items={[
                  { label: "Planificado", onSelect: () => void setMs.run(m.id, "planned") },
                  { label: "Activo", onSelect: () => void setMs.run(m.id, "active") },
                  { label: "Completado", onSelect: () => void setMs.run(m.id, "done") },
                  "sep",
                  { label: "Eliminar hito", danger: true, onSelect: () => void delMs.run(m.id) },
                ]} />
              )}
            />
            {m && list.length > 0 && <div className="px-4 pb-2"><Progress value={(list.filter((t) => t.status === "done").length / list.length) * 100} /></div>}
            <ul className="px-4 pb-3">
              {list.map((t) => (
                <li key={t.id} className="flex items-center gap-2 py-1 text-[13px]">
                  <button aria-label={t.status === "done" ? "Marcar como pendiente" : "Completar"} onClick={() => void toggle.run(t.id, t.status !== "done")}>
                    {t.status === "done" ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-ink-3" />}
                  </button>
                  <span className={cx("flex-1", t.status === "done" && "text-ink-3 line-through")}>{t.title}</span>
                  <span className="text-[11.5px] text-ink-3">{TASK_STATUS_LABEL[t.status]}{t.due_on ? ` · ${fmtDate(t.due_on)}` : ""}</span>
                </li>
              ))}
              {!list.length && <p className="text-[12.5px] text-ink-3">Sin tareas en este hito.</p>}
            </ul>
          </Card>
        ),
      )}
    </div>
  );
}

function ScorecardTab({ p }: { p: Project }) {
  const txs = useData(["transactions", "project", p.id, "all"], () => listTransactions({ projectId: p.id, from: addDays(todayStr(), -89) }));
  const tasks = useTasks();
  const save = useAction((k: string, v: number | undefined) => updateProject(p.id, { scorecard: { ...p.scorecard, [k]: v } }), { success: "Scorecard actualizado" });
  const s = summarize(txs.data ?? []);
  const anyRev = Object.values(s).reduce((a, b) => a + b.netRevenue, 0);
  const anyProfit = Object.values(s).reduce((a, b) => a + Math.sign(b.operatingProfit), 0);
  const pt = (tasks.data ?? []).filter((t) => t.project_id === p.id);
  const sc = buildScorecard({
    scorecard: p.scorecard,
    netRevenue90d: anyRev,
    operatingProfit90d: anyProfit,
    daysSinceActivity: p.last_activity_at ? daysBetween(p.last_activity_at.slice(0, 10), todayStr()) : null,
    openTasks: pt.filter((t) => !["done", "canceled"].includes(t.status)).length,
    doneTasks30d: pt.filter((t) => t.completed_at && t.completed_at >= addDays(todayStr(), -30)).length,
  });
  return (
    <Card>
      <CardHeader title="Project Scorecard" subtitle="Criterios explícitos: la mitad la evaluás vos, la otra mitad se calcula con evidencia. No es una predicción financiera." actions={<Tip content="Promedio de los criterios con dato, sobre 100. Requiere al menos 3 criterios."><span className="text-[22px] font-semibold tabular">{sc.total ?? "—"}</span></Tip>} />
      <table className="tbl">
        <thead><tr><th>Criterio</th><th>Fuente</th><th>Valor (0–5)</th><th>Fundamento</th></tr></thead>
        <tbody>
          {sc.criteria.map((c) => (
            <tr key={c.key}>
              <td className="font-medium">{c.label}</td>
              <td><Badge tone={c.source === "manual" ? "neutral" : "accent"}>{c.source}</Badge></td>
              <td>
                {c.source === "manual" ? (
                  <Select className="w-28" value={String((p.scorecard as Record<string, number | undefined>)[c.key] ?? "")} onChange={(e) => void save.run(c.key, e.target.value ? Number(e.target.value) : undefined)} aria-label={c.label}>
                    <option value="">Sin evaluar</option>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                ) : (
                  <span className="tabular">{c.value ?? "—"}</span>
                )}
              </td>
              <td className="text-[12px] text-ink-3">{c.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

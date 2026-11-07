import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Activity, CheckCircle2, Code2, ExternalLink, FolderOpen, GitBranch, GitCommit, GitPullRequest, HeartPulse, Pencil, Play, Plus, Rocket, Tag, Trash2, XCircle, Download, RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Select, Skeleton, Switch, Tabs, Tip } from "@/components/ui/primitives";
import { ProjectAvatar } from "@/components/common";
import { useAction, useData } from "@/app/hooks";
import { useProjects } from "@/app/queries";
import { listRepositories, linkRepository } from "@/repos/projects";
import { listDeployments, listDevItems, listHealthChecks, listHealthResults, saveHealthCheck, deleteHealthCheck } from "@/repos/dev";
import { db } from "@/db";
import { runHealthCheck } from "@/integrations/connectors/local";
import { importIssuesAsTasks } from "@/integrations/connectors/github";
import { syncConnector } from "@/integrations/runner";
import type { HealthCheck, Repository } from "@/domain/types";
import { openInEditor, openUrl, revealPath } from "@/platform/files";
import { isNative } from "@/platform/runtime";
import { fmtDate, relTime } from "@/lib/format";
import { cx } from "@/lib/util";
import { useToast } from "@/components/ui/feedback";

type Tab = "timeline" | "repos" | "deploys" | "monitoring";

export default function DevelopmentPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? (params.get("repo") ? "repos" : "timeline");
  const sync = useAction(() => syncConnector("github"), { success: (r) => (r.ok ? `GitHub: ${r.message}` : null), error: "GitHub" });
  return (
    <div>
      <PageHeader title="Development" subtitle="Software Engineering Hub: repositorios, CI/CD, despliegues y monitoreo" actions={<Button icon={<RefreshCw className="size-4" />} loading={sync.pending} onClick={() => void sync.run()}>Sincronizar GitHub</Button>} />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ value: "timeline", label: "Developer Timeline" }, { value: "repos", label: "Repositorios" }, { value: "deploys", label: "Despliegues" }, { value: "monitoring", label: "Monitoring" }]} />
      {tab === "timeline" && <Timeline />}
      {tab === "repos" && <Repos />}
      {tab === "deploys" && <Deploys />}
      {tab === "monitoring" && <Monitoring />}
    </div>
  );
}

const DEV_TYPES: Record<string, { label: string; icon: React.ReactNode }> = {
  commit: { label: "Commit", icon: <GitCommit className="size-3.5 text-ink-3" /> },
  pr_merged: { label: "PR fusionado", icon: <GitPullRequest className="size-3.5 text-accent" /> },
  release: { label: "Release", icon: <Tag className="size-3.5 text-info" /> },
  deploy: { label: "Deploy", icon: <Rocket className="size-3.5 text-success" /> },
  deploy_failed: { label: "Deploy fallido", icon: <XCircle className="size-3.5 text-danger" /> },
  workflow_failed: { label: "Workflow fallido", icon: <XCircle className="size-3.5 text-danger" /> },
  issue_closed: { label: "Issue cerrada", icon: <CheckCircle2 className="size-3.5 text-ink-3" /> },
  service_down: { label: "Alerta de servicio", icon: <HeartPulse className="size-3.5 text-danger" /> },
  service_recovered: { label: "Servicio recuperado", icon: <HeartPulse className="size-3.5 text-success" /> },
};

function Timeline() {
  const projects = useProjects();
  const [projectId, setProjectId] = React.useState("");
  const [type, setType] = React.useState("");
  const events = useData(["dev-timeline", projectId, type], () => {
    const types = type ? [type] : Object.keys(DEV_TYPES);
    const where = [`type IN (${types.map(() => "?").join(",")})`];
    const params: string[] = [...types];
    if (projectId) { where.push("project_id = ?"); params.push(projectId); }
    return db().select<{ id: string; occurred_at: string; type: string; title: string; url: string | null; project_id: string | null; source: string }>(`SELECT * FROM activity_events WHERE ${where.join(" AND ")} ORDER BY occurred_at DESC LIMIT 300`, params);
  });
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Select className="w-52" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Proyecto"><option value="">Todos los proyectos</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Select className="w-48" value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo"><option value="">Todos los eventos</option>{Object.entries(DEV_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
      </div>
      {events.isLoading ? <Skeleton className="h-80" /> : !(events.data ?? []).length ? (
        <Card><EmptyState icon={<Activity />} title="Sin eventos de desarrollo" body="Conectá GitHub y Vercel/Netlify, vinculá repositorios a proyectos y agregá health checks." /></Card>
      ) : (
        <Card>
          <ol className="relative px-4 py-3">
            <span className="absolute bottom-3 left-[27px] top-3 w-px bg-line" aria-hidden />
            {(events.data ?? []).map((e) => {
              const p = projects.data?.find((x) => x.id === e.project_id);
              return (
                <li key={e.id} className="relative flex items-center gap-3 py-1.5">
                  <span className="z-10 flex size-6 items-center justify-center rounded-full border border-line bg-surface">{DEV_TYPES[e.type]?.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{e.title}</p>
                    <p className="flex items-center gap-1.5 text-[11.5px] text-ink-3">{p && <><ProjectAvatar project={p} size={13} />{p.name} ·</>}{DEV_TYPES[e.type]?.label} · {e.source}</p>
                  </div>
                  <span className="shrink-0 text-[11.5px] text-ink-3">{relTime(e.occurred_at)}</span>
                  {e.url && <Button size="xs" variant="ghost" icon={<ExternalLink className="size-3.5" />} aria-label="Abrir" onClick={() => void openUrl(e.url!)} />}
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </div>
  );
}

function Repos() {
  const repos = useData(["repositories"], listRepositories);
  const projects = useProjects();
  const items = useData(["dev_items", "all"], () => listDevItems({ limit: 3000 }));
  const toast = useToast();
  const link = useAction((repo: string, pid: string | null) => linkRepository(repo, pid), { success: "Repositorio vinculado" });
  const imp = useAction((r: Repository) => importIssuesAsTasks(r.full_name!, r.project_id), { success: (x) => `${x.created} issues importadas como tareas · ${x.skipped} ya existían` });
  const safe = (fn: () => Promise<unknown>) => () => void fn().catch((e: Error) => toast.show({ title: "No se pudo abrir", body: e.message, tone: "danger" }));
  if (repos.isLoading) return <Skeleton className="h-80" />;
  if (!(repos.data ?? []).length) return <Card><EmptyState icon={<GitBranch />} title="Sin repositorios" body="Conectá GitHub o descubrí repositorios locales en Projects → Descubrir." /></Card>;
  return (
    <Card className="overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>Repositorio</th><th>Proyecto</th><th>Último commit</th><th className="text-right">PRs</th><th className="text-right">Issues</th><th>CI</th><th className="text-right">Accesos</th></tr></thead>
        <tbody>
          {(repos.data ?? []).map((r) => {
            const runs = (items.data ?? []).filter((i) => i.repository_id === r.id && i.kind === "workflow_run");
            const lastRun = runs[0];
            return (
              <tr key={r.id}>
                <td>
                  <p className="flex items-center gap-1.5 font-medium"><GitBranch className="size-3.5 text-ink-3" />{r.full_name ?? r.canonical_key.replace(/^local:/, "")}</p>
                  <p className="text-[11px] text-ink-3">{r.provider}{r.is_private ? " · privado" : ""}{r.is_archived ? " · archivado" : ""}{r.primary_language ? ` · ${r.primary_language}` : ""}{r.default_branch ? ` · ${r.default_branch}` : ""}</p>
                </td>
                <td>
                  <Select className="w-40" value={r.project_id ?? ""} onChange={(e) => void link.run(r.id, e.target.value || null)} aria-label="Proyecto">
                    <option value="">Sin vincular</option>
                    {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </td>
                <td className="max-w-64"><p className="truncate text-[12.5px]">{r.last_commit_message ?? "—"}</p><p className="text-[11px] text-ink-3">{relTime(r.last_commit_at ?? r.pushed_at)}</p></td>
                <td className="text-right tabular">{r.open_prs ?? "—"}</td>
                <td className="text-right tabular">{r.open_issues ?? "—"}</td>
                <td>{lastRun ? <Badge tone={lastRun.state === "success" ? "success" : lastRun.state === "failure" ? "danger" : "warning"}>{lastRun.state}</Badge> : <span className="text-[11.5px] text-ink-3">—</span>}</td>
                <td className="whitespace-nowrap text-right">
                  {r.html_url && <Tip content="Abrir en GitHub"><Button size="xs" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={safe(() => openUrl(r.html_url!))} /></Tip>}
                  {r.local_path && isNative() && <Tip content="Mostrar en Finder"><Button size="xs" variant="ghost" icon={<FolderOpen className="size-3.5" />} onClick={safe(() => revealPath(r.local_path!))} /></Tip>}
                  {r.local_path && isNative() && <Tip content="Abrir en VS Code"><Button size="xs" variant="ghost" icon={<Code2 className="size-3.5" />} onClick={safe(() => openInEditor(r.local_path!))} /></Tip>}
                  {r.provider === "github" && r.full_name && <Tip content="Importar issues abiertas como tareas (no modifica GitHub)"><Button size="xs" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => void imp.run(r)} /></Tip>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function Deploys() {
  const deploys = useData(["deployments"], () => listDeployments({ limit: 300 }));
  const projects = useProjects();
  const nav = useNavigate();
  if (deploys.isLoading) return <Skeleton className="h-80" />;
  if (!(deploys.data ?? []).length) return <Card><EmptyState icon={<Rocket />} title="Despliegues: No conectados" body="Conectá Vercel o Netlify. Railway y Render están previstos; mientras tanto usá health checks." action={<Button onClick={() => nav("/integrations")}>Ir a Integrations</Button>} /></Card>;
  return (
    <Card>
      <table className="tbl">
        <thead><tr><th>Estado</th><th>Proyecto</th><th>Proveedor</th><th>Entorno</th><th>Commit</th><th>Fecha</th><th /></tr></thead>
        <tbody>
          {(deploys.data ?? []).map((d) => (
            <tr key={d.id}>
              <td><Badge tone={d.status === "ready" ? "success" : d.status === "error" ? "danger" : d.status === "canceled" ? "neutral" : "warning"}>{d.status}</Badge></td>
              <td>{projects.data?.find((p) => p.id === d.project_id)?.name ?? <span className="text-ink-3">{d.provider_project} (sin vincular)</span>}</td>
              <td className="text-ink-2">{d.provider}</td>
              <td className="text-ink-2">{d.environment ?? "—"}</td>
              <td className="max-w-72 truncate text-[12px] text-ink-2">{d.commit_message ?? d.commit_sha?.slice(0, 7) ?? "—"}{d.branch ? ` · ${d.branch}` : ""}</td>
              <td className="text-[12px] text-ink-3">{fmtDate(d.created_at_ext, "d MMM HH:mm")}</td>
              <td className="text-right">{(d.inspect_url ?? d.url) && <Button size="xs" variant="ghost" icon={<ExternalLink className="size-3.5" />} aria-label="Abrir" onClick={() => void openUrl((d.inspect_url ?? d.url)!)} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-3">Un deploy exitoso no implica que la aplicación esté saludable. Usá Monitoring para verificar disponibilidad.</p>
    </Card>
  );
}

function Monitoring() {
  const checks = useData(["health_checks"], listHealthChecks);
  const projects = useProjects();
  const [editing, setEditing] = React.useState<HealthCheck | "new" | null>(null);
  const del = useAction((id: string) => deleteHealthCheck(id), { success: "Health check eliminado" });
  const run = useAction((c: HealthCheck) => runHealthCheck(c), { success: (ok) => (ok ? "Responde correctamente" : "El chequeo falló") });
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-[12.5px] text-ink-2">
        <span>Los chequeos se ejecutan <b>solo mientras Sovare HQ está abierta</b> (también minimizada o en la barra de menú). Para monitoreo 24/7 con la Mac apagada necesitás un servicio externo (UptimeRobot, Better Stack…).</span>
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>Nuevo health check</Button>
      </div>
      {checks.isLoading ? <Skeleton className="h-40" /> : !(checks.data ?? []).length ? (
        <Card><EmptyState icon={<HeartPulse />} title="Sin health checks" body="Agregá endpoints como https://tuapp.com/api/health para medir disponibilidad, código HTTP y latencia." /></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {(checks.data ?? []).map((c) => <CheckCard key={c.id} c={c} project={projects.data?.find((p) => p.id === c.project_id)?.name} onEdit={() => setEditing(c)} onDelete={() => void del.run(c.id)} onRun={() => void run.run(c)} />)}
        </div>
      )}
      <HealthDialog value={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function CheckCard({ c, project, onEdit, onDelete, onRun }: { c: HealthCheck; project?: string; onEdit: () => void; onDelete: () => void; onRun: () => void }) {
  const results = useData(["health_results", c.id], () => listHealthResults(c.id, 60));
  const r = results.data ?? [];
  const last = r[0];
  const uptime = r.length ? (r.filter((x) => x.ok).length / r.length) * 100 : null;
  const lat = r.filter((x) => x.latency_ms !== null);
  const avg = lat.length ? Math.round(lat.reduce((s, x) => s + x.latency_ms!, 0) / lat.length) : null;
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><span className={cx("size-2 rounded-full", !last ? "bg-line-strong" : last.ok ? "bg-success" : "bg-danger")} />{c.name}</span>}
        subtitle={<span className="font-mono">{c.method} {c.url}</span>}
        actions={<>
          <Tip content="Ejecutar ahora"><Button size="xs" variant="ghost" icon={<Play className="size-3.5" />} onClick={onRun} /></Tip>
          <Button size="xs" variant="ghost" icon={<Pencil className="size-3.5" />} aria-label="Editar" onClick={onEdit} />
          <Button size="xs" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label="Eliminar" onClick={onDelete} />
        </>}
      />
      <div className="grid grid-cols-4 gap-2 px-4 pb-2 text-[12px]">
        <div><p className="text-ink-3">Estado</p><p className="font-medium">{!last ? "Sin chequeos" : last.ok ? `OK · ${last.status_code}` : last.status_code ?? "Error"}</p></div>
        <div><p className="text-ink-3">Disponibilidad</p><p className="font-medium tabular">{uptime === null ? "—" : `${uptime.toFixed(1)}%`}</p></div>
        <div><p className="text-ink-3">Latencia media</p><p className="font-medium tabular">{avg === null ? "—" : `${avg} ms`}</p></div>
        <div><p className="text-ink-3">Último chequeo</p><p className="font-medium">{last ? relTime(last.checked_at) : "—"}</p></div>
      </div>
      <div className="flex h-6 items-end gap-[2px] px-4 pb-3" aria-label="Historial de chequeos">
        {[...r].reverse().map((x) => <Tip key={x.id} content={`${fmtDate(x.checked_at, "d MMM HH:mm")} · ${x.ok ? "OK" : x.error ?? "falló"}${x.latency_ms ? ` · ${x.latency_ms} ms` : ""}`}><span className={cx("h-full w-1.5 rounded-sm", x.ok ? "bg-success/70" : "bg-danger")} /></Tip>)}
        {!r.length && <span className="text-[11.5px] text-ink-3">Sin historial</span>}
      </div>
      {last && !last.ok && last.error && <p className="border-t border-line px-4 py-2 text-[11.5px] text-danger">{last.error}</p>}
      <p className="border-t border-line px-4 py-1.5 text-[11px] text-ink-3">{project ?? "Sin proyecto"} · cada {c.interval_minutes} min · espera HTTP {c.expected_status}{!c.enabled && " · pausado"}</p>
    </Card>
  );
}

function HealthDialog({ value, onClose }: { value: HealthCheck | "new" | null; onClose: () => void }) {
  const projects = useProjects();
  const c = value && value !== "new" ? value : null;
  const [f, setF] = React.useState({ name: "", url: "", method: "GET" as "GET" | "HEAD", expected_status: 200, interval_minutes: 15, timeout_ms: 10000, project_id: "", enabled: true });
  React.useEffect(() => {
    if (value) setF({ name: c?.name ?? "", url: c?.url ?? "https://", method: c?.method ?? "GET", expected_status: c?.expected_status ?? 200, interval_minutes: c?.interval_minutes ?? 15, timeout_ms: c?.timeout_ms ?? 10000, project_id: c?.project_id ?? "", enabled: c?.enabled ?? true });
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction(() => saveHealthCheck({ ...f, project_id: f.project_id || null }, c?.id), { success: "Health check guardado" });
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} title={c ? "Editar health check" : "Nuevo health check"} description="Solo se consultan URLs que vos registrás, con GET o HEAD y sin credenciales." footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!f.name || !/^https?:\/\/.+/.test(f.url)} onClick={async () => (await save.run(), onClose())}>Guardar</Button></>}>
      <div className="grid grid-cols-2 gap-3 pb-3">
        <Field label="Nombre"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="GastroOS API" /></Field>
        <Field label="Proyecto"><Select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">—</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="URL" className="col-span-2"><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        <Field label="Método"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as "GET" })}><option>GET</option><option>HEAD</option></Select></Field>
        <Field label="Código esperado"><Input type="number" value={f.expected_status} onChange={(e) => setF({ ...f, expected_status: Number(e.target.value) })} /></Field>
        <Field label="Intervalo (min)"><Input type="number" min={1} value={f.interval_minutes} onChange={(e) => setF({ ...f, interval_minutes: Number(e.target.value) })} /></Field>
        <Field label="Timeout (ms)"><Input type="number" min={1000} value={f.timeout_ms} onChange={(e) => setF({ ...f, timeout_ms: Number(e.target.value) })} /></Field>
        <label className="col-span-2 flex items-center gap-2 text-[12.5px]"><Switch checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Activo" />Activo</label>
      </div>
    </Dialog>
  );
}

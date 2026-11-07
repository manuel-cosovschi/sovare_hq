import * as React from "react";
import { ExternalLink, Activity as ActivityIcon, GitCommit, GitPullRequest, Rocket, XCircle, CheckCircle2, DollarSign, Megaphone, FolderPlus, AlertTriangle, Tag, RefreshCw } from "lucide-react";
import { Button, Card, EmptyState, Input, PageHeader, Select, Skeleton } from "@/components/ui/primitives";
import { ProjectAvatar } from "@/components/common";
import { useData } from "@/app/hooks";
import { useProjects } from "@/app/queries";
import { db } from "@/db";
import type { ActivityEvent } from "@/domain/types";
import { openUrl } from "@/platform/files";
import { CONNECTOR_NAMES } from "@/integrations/names";
import { fmtDate } from "@/lib/format";
import { addDays, todayStr } from "@/lib/util";

const TYPE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  sale: { label: "Venta / ingreso", icon: <DollarSign className="size-3.5 text-success" /> },
  expense: { label: "Gasto", icon: <DollarSign className="size-3.5 text-ink-3" /> },
  commit: { label: "Commit", icon: <GitCommit className="size-3.5 text-ink-3" /> },
  pr_merged: { label: "PR fusionado", icon: <GitPullRequest className="size-3.5 text-accent" /> },
  release: { label: "Release", icon: <Tag className="size-3.5 text-info" /> },
  deploy: { label: "Deploy", icon: <Rocket className="size-3.5 text-success" /> },
  deploy_failed: { label: "Deploy fallido", icon: <XCircle className="size-3.5 text-danger" /> },
  workflow_failed: { label: "Workflow fallido", icon: <XCircle className="size-3.5 text-danger" /> },
  issue_closed: { label: "Issue cerrada", icon: <CheckCircle2 className="size-3.5 text-ink-3" /> },
  task_completed: { label: "Tarea completada", icon: <CheckCircle2 className="size-3.5 text-success" /> },
  campaign_started: { label: "Campaña iniciada", icon: <Megaphone className="size-3.5 text-accent" /> },
  campaign_stopped: { label: "Campaña detenida", icon: <Megaphone className="size-3.5 text-ink-3" /> },
  subscription_renewed: { label: "Suscripción renovada", icon: <RefreshCw className="size-3.5 text-ink-3" /> },
  project_added: { label: "Proyecto agregado", icon: <FolderPlus className="size-3.5 text-accent" /> },
  service_down: { label: "Servicio caído", icon: <AlertTriangle className="size-3.5 text-danger" /> },
  service_recovered: { label: "Servicio recuperado", icon: <CheckCircle2 className="size-3.5 text-success" /> },
  integration_error: { label: "Error de integración", icon: <AlertTriangle className="size-3.5 text-warning" /> },
};

export default function ActivityPage() {
  const projects = useProjects();
  const [days, setDays] = React.useState("30");
  const [source, setSource] = React.useState("");
  const [type, setType] = React.useState("");
  const [projectId, setProjectId] = React.useState("");
  const [q, setQ] = React.useState("");
  const [limit, setLimit] = React.useState(200);
  const since = days === "all" ? "0000" : addDays(todayStr(), -Number(days));
  const events = useData(["activity", since, source, type, projectId, q, limit], () => {
    const where = ["occurred_at >= ?"];
    const params: (string | number)[] = [since];
    if (source) { where.push("source = ?"); params.push(source); }
    if (type) { where.push("type = ?"); params.push(type); }
    if (projectId) { where.push("project_id = ?"); params.push(projectId); }
    if (q) { where.push("(title LIKE ? OR detail LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
    return db().select<ActivityEvent>(`SELECT * FROM activity_events WHERE ${where.join(" AND ")} ORDER BY occurred_at DESC LIMIT ?`, [...params, limit]);
  });
  const facets = useData(["activity-facets"], async () => ({
    sources: (await db().select<{ source: string }>("SELECT DISTINCT source FROM activity_events ORDER BY source")).map((r) => r.source),
    types: (await db().select<{ type: string }>("SELECT DISTINCT type FROM activity_events ORDER BY type")).map((r) => r.type),
  }));
  const grouped = new Map<string, ActivityEvent[]>();
  for (const e of events.data ?? []) {
    const d = e.occurred_at.slice(0, 10);
    if (!grouped.has(d)) grouped.set(d, []);
    grouped.get(d)!.push(e);
  }
  return (
    <div>
      <PageHeader title="Activity" subtitle="Historial unificado de todos tus proyectos y fuentes" />
      <div className="mb-3 flex flex-wrap gap-2">
        <Select className="w-36" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Período">
          <option value="1">Últimas 24 h</option><option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option><option value="all">Todo</option>
        </Select>
        <Select className="w-44" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Plataforma">
          <option value="">Todas las fuentes</option>
          {facets.data?.sources.map((s) => <option key={s} value={s}>{CONNECTOR_NAMES[s] ?? (s === "sovare" ? "Sovare HQ" : s)}</option>)}
        </Select>
        <Select className="w-44" value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {facets.data?.types.map((t) => <option key={t} value={t}>{TYPE_META[t]?.label ?? t}</option>)}
        </Select>
        <Select className="w-48" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Proyecto">
          <option value="">Todos los proyectos</option>
          {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Input className="w-56" placeholder="Buscar en eventos" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {events.isLoading ? <Skeleton className="h-96" /> : !(events.data ?? []).length ? (
        <Card><EmptyState icon={<ActivityIcon />} title="Sin eventos para estos filtros" body="La actividad se genera al registrar movimientos, completar tareas y sincronizar integraciones." /></Card>
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([day, list]) => (
            <div key={day}>
              <p className="mb-1.5 text-[12px] font-semibold capitalize text-ink-3">{day === todayStr() ? "Hoy" : day === addDays(todayStr(), -1) ? "Ayer" : fmtDate(day, "EEEE d 'de' MMMM")}</p>
              <Card>
                {list.map((e) => {
                  const p = projects.data?.find((x) => x.id === e.project_id);
                  return (
                    <div key={e.id} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
                      <span className="flex size-6 items-center justify-center rounded-md bg-surface-2">{TYPE_META[e.type]?.icon ?? <ActivityIcon className="size-3.5 text-ink-3" />}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px]">{e.title}</p>
                        <p className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
                          {p && <><ProjectAvatar project={p} size={13} />{p.name} ·</>} {CONNECTOR_NAMES[e.source] ?? (e.source === "sovare" ? "Sovare HQ" : e.source)} · {TYPE_META[e.type]?.label ?? e.type}
                          {e.external_id && <span className="truncate font-mono text-[10.5px]" title="Identificador externo">· {e.external_id.slice(0, 40)}</span>}
                        </p>
                        {e.detail && <p className="truncate text-[11.5px] text-ink-3">{e.detail}</p>}
                      </div>
                      <span className="shrink-0 text-[11.5px] tabular text-ink-3">{fmtDate(e.occurred_at, "HH:mm")}</span>
                      {e.url && <Button size="xs" variant="ghost" icon={<ExternalLink className="size-3.5" />} aria-label="Abrir origen" onClick={() => void openUrl(e.url!)} />}
                    </div>
                  );
                })}
              </Card>
            </div>
          ))}
          {(events.data ?? []).length >= limit && <div className="text-center"><Button onClick={() => setLimit(limit + 200)}>Cargar más</Button></div>}
        </div>
      )}
    </div>
  );
}

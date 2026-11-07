import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as RCtx from "@radix-ui/react-context-menu";
import { FolderKanban, Plus, ScanSearch, LayoutGrid, List, Search, Sparkles, MoreHorizontal } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Menu, PageHeader, Segmented, Select, Skeleton } from "@/components/ui/primitives";
import { ProjectAvatar, StatusBadge } from "@/components/common";
import { useApp } from "@/app/AppContext";
import { useAction, useData } from "@/app/hooks";
import { useProjects, useTasks } from "@/app/queries";
import { listRepositories, updateProject, deleteProject } from "@/repos/projects";
import { listTransactions } from "@/repos/finance";
import { byProject } from "@/domain/finance";
import { KNOWN_CANDIDATES, matchKnown } from "@/domain/discovery";
import { ACTIVE_STATUSES, LIVE_STATUSES, PRIORITY_LABEL, PROJECT_STATUSES, PROJECT_TYPES, STATUS_LABEL, TYPE_LABEL, type Project, type ProjectStatus } from "@/domain/types";
import { formatMoney } from "@/domain/money";
import { relTime } from "@/lib/format";
import { addDays, todayStr } from "@/lib/util";
import { DiscoveryDialog } from "./DiscoveryDialog";
import { ProjectDialog } from "./ProjectDialog";
import { useToast } from "@/components/ui/feedback";

export default function ProjectsPage() {
  const nav = useNavigate();
  const app = useApp();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const projects = useProjects();
  const tasks = useTasks();
  const repos = useData(["repositories"], listRepositories);
  const txs = useData(["transactions", "30d"], () => listTransactions({ from: addDays(todayStr(), -29) }));
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState(params.get("filter") ?? "open");
  const [type, setType] = React.useState("all");
  const [view, setView] = React.useState<"cards" | "table">(() => (localStorage.getItem("sovare.projects.view") as "cards" | "table") ?? "table");
  const [editing, setEditing] = React.useState<Project | null>(null);
  const [preset, setPreset] = React.useState<Partial<Project> | null>(null);
  const discover = params.get("discover") === "1";

  const setStatusFor = useAction((id: string, s: ProjectStatus) => updateProject(id, { status: s }), { success: "Estado actualizado" });
  const remove = useAction((id: string) => deleteProject(id), { success: "Proyecto eliminado" });

  const fin = byProject(txs.data ?? []);
  const list = (projects.data ?? [])
    .filter((p) => (status === "open" ? p.status !== "archived" : status === "all" ? true : status === "active" ? ACTIVE_STATUSES.includes(p.status) : status === "live" ? LIVE_STATUSES.includes(p.status) : p.status === status))
    .filter((p) => type === "all" || p.type === type)
    .filter((p) => !q || `${p.name} ${p.description ?? ""} ${p.category ?? ""} ${p.frameworks.join(" ")}`.toLowerCase().includes(q.toLowerCase()));

  const registeredKnown = new Set((projects.data ?? []).map((p) => matchKnown(p.name)).filter(Boolean));
  const pendingKnown = KNOWN_CANDIDATES.filter((k) => !registeredKnown.has(k.name));

  const menuItems = (p: Project) => [
    { label: "Abrir ficha", onSelect: () => nav(`/projects/${p.id}`) },
    { label: "Editar", onSelect: () => setEditing(p) },
    "sep" as const,
    ...(["development", "launched", "production", "paused"] as ProjectStatus[]).filter((s) => s !== p.status).map((s) => ({ label: `Marcar como ${STATUS_LABEL[s]}`, onSelect: () => void setStatusFor.run(p.id, s) })),
    { label: p.status === "archived" ? "Desarchivar (Idea)" : "Archivar", onSelect: () => void setStatusFor.run(p.id, p.status === "archived" ? "idea" : "archived") },
    "sep" as const,
    {
      label: "Eliminar…",
      danger: true,
      onSelect: async () => {
        if (await toast.confirm({ title: `¿Eliminar ${p.name}?`, body: "Se eliminan sus enlaces, hitos y métricas registradas en Sovare HQ. Las transacciones y tareas se conservan sin proyecto. No se toca ningún archivo ni repositorio.", danger: true, confirmLabel: "Eliminar" })) void remove.run(p.id);
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={`${projects.data?.length ?? 0} proyectos registrados`}
        actions={
          <>
            <Button icon={<ScanSearch className="size-4" />} onClick={() => setParams({ discover: "1" })}>
              Descubrir
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => app.openQuick("project")}>
              Nuevo proyecto
            </Button>
          </>
        }
      />
      {pendingKnown.length > 0 && (
        <Card className="mb-4">
          <CardHeader title="Candidatos conocidos" icon={<Sparkles className="size-4 text-accent" />} subtitle="Proyectos que mencionaste. No se asume que existan, facturen ni estén desplegados: registralos solo si corresponde, o detectalos con Descubrir." />
          <div className="flex flex-wrap gap-2 px-4 pb-4">
            {pendingKnown.map((k) => (
              <button key={k.name} onClick={() => setPreset({ name: k.name, description: k.description, type: k.type, category: k.category, status: "idea" })} className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong px-2.5 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:border-accent hover:bg-accent-soft hover:text-ink">
                <Plus className="size-3.5" />
                {k.name}
                <span className="text-ink-3">· {TYPE_LABEL[k.type]}</span>
              </button>
            ))}
          </div>
        </Card>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input className="w-60 pl-7" placeholder="Buscar por nombre, stack, categoría" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar proyectos" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" aria-label="Estado">
          <option value="open">No archivados</option>
          <option value="active">Activos</option>
          <option value="live">En producción</option>
          <option value="all">Todos</option>
          {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-44" aria-label="Tipo">
          <option value="all">Todos los tipos</option>
          {PROJECT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </Select>
        <Segmented className="ml-auto" value={view} onChange={(v) => (setView(v), localStorage.setItem("sovare.projects.view", v))} options={[{ value: "table", label: <List className="size-3.5" /> }, { value: "cards", label: <LayoutGrid className="size-3.5" /> }]} />
      </div>
      {projects.isLoading ? (
        <Skeleton className="h-72" />
      ) : !list.length ? (
        <Card>
          <EmptyState icon={<FolderKanban />} title={projects.data?.length ? "Ningún proyecto coincide con los filtros" : "Registrá tu primer proyecto"} body={projects.data?.length ? undefined : "Crealo manualmente, elegí un candidato conocido o descubrí proyectos en tus carpetas."} action={!projects.data?.length && <Button variant="primary" onClick={() => setParams({ discover: "1" })}>Descubrir en carpetas</Button>} />
        </Card>
      ) : view === "table" ? (
        <Card className="overflow-hidden">
          <table className="tbl">
            <thead>
              <tr>
                <th>Proyecto</th>
                <th>Estado</th>
                <th>Prioridad</th>
                <th>Stack</th>
                <th>Repositorio</th>
                <th className="text-right">Ingresos 30 d</th>
                <th className="text-right">Tareas</th>
                <th>Actividad</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const f = fin.find((x) => x.projectId === p.id)?.summary ?? {};
                const repo = (repos.data ?? []).find((r) => r.project_id === p.id);
                const open = (tasks.data ?? []).filter((t) => t.project_id === p.id && !["done", "canceled"].includes(t.status) && !t.parent_id).length;
                return (
                  <RCtx.Root key={p.id}>
                    <RCtx.Trigger asChild>
                      <tr className="cursor-default" onDoubleClick={() => nav(`/projects/${p.id}`)} onClick={() => nav(`/projects/${p.id}`)}>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <ProjectAvatar project={p} size={26} />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{p.name}</p>
                              <p className="truncate text-[11.5px] text-ink-3">{TYPE_LABEL[p.type]}{p.category ? ` · ${p.category}` : ""}</p>
                            </div>
                          </div>
                        </td>
                        <td><StatusBadge status={p.status} /></td>
                        <td className="text-ink-2">{PRIORITY_LABEL[p.priority]}</td>
                        <td className="max-w-48 truncate text-[12px] text-ink-2">{[...p.frameworks, ...p.languages].slice(0, 3).join(", ") || "—"}</td>
                        <td className="max-w-44 truncate text-[12px] text-ink-2">{repo?.full_name ?? (repo ? "local" : "—")}</td>
                        <td className="text-right tabular">{Object.keys(f).length ? Object.entries(f).map(([c, b]) => <div key={c}>{formatMoney(b.netRevenue, c, { compact: true })}</div>) : <span className="text-[12px] text-ink-3">Sin datos</span>}</td>
                        <td className="text-right tabular">{open}</td>
                        <td className="text-[12px] text-ink-3">{relTime(p.last_activity_at)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <Menu trigger={<Button size="xs" variant="ghost" icon={<MoreHorizontal className="size-4" />} aria-label="Acciones" />} items={menuItems(p)} />
                        </td>
                      </tr>
                    </RCtx.Trigger>
                    <RCtx.Portal>
                      <RCtx.Content className="z-[70] min-w-44 rounded-lg border border-line bg-surface p-1 shadow-[var(--shadow-md)]">
                        {menuItems(p).map((it, i) =>
                          it === "sep" ? (
                            <RCtx.Separator key={i} className="my-1 h-px bg-line" />
                          ) : (
                            <RCtx.Item key={i} onSelect={it.onSelect} className={`flex h-7 items-center rounded-[5px] px-2 text-[12.5px] outline-none data-[highlighted]:bg-surface-2 ${"danger" in it && it.danger ? "text-danger" : ""}`}>
                              {it.label}
                            </RCtx.Item>
                          ),
                        )}
                      </RCtx.Content>
                    </RCtx.Portal>
                  </RCtx.Root>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <Card key={p.id} className="cursor-default p-4 transition-colors hover:border-line-strong" onClick={() => nav(`/projects/${p.id}`)}>
              <div className="flex items-start gap-3">
                <ProjectAvatar project={p} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{p.name}</p>
                  <p className="text-[12px] text-ink-3">{TYPE_LABEL[p.type]} · {relTime(p.last_activity_at)}</p>
                </div>
                <StatusBadge status={p.status} />
              </div>
              <p className="mt-2 line-clamp-2 min-h-8 text-[12.5px] text-ink-2">{p.description ?? "Sin descripción"}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {[...p.frameworks, ...p.languages].slice(0, 4).map((t) => <Badge key={t}>{t}</Badge>)}
              </div>
            </Card>
          ))}
        </div>
      )}
      <DiscoveryDialog open={discover} onClose={() => setParams({})} />
      <ProjectDialog open={!!editing || !!preset} project={editing} preset={preset ?? undefined} onClose={() => (setEditing(null), setPreset(null))} />
    </div>
  );
}

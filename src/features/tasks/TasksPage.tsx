import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, Circle, Columns3, Flag, ListOrdered, Plus, SlidersHorizontal, AlertCircle, Map } from "lucide-react";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Input, PageHeader, Progress, Segmented, Select, Skeleton, Tip } from "@/components/ui/primitives";
import { ProjectAvatar } from "@/components/common";
import { useApp } from "@/app/AppContext";
import { useAction, useData } from "@/app/hooks";
import { useMilestones, useProjects, useTasks } from "@/app/queries";
import { updateTask } from "@/repos/tasks";
import { getPref, setPref } from "@/repos/core";
import { scoreTask, DEFAULT_WEIGHTS, FACTOR_LABEL, type PriorityWeights } from "@/domain/priorities";
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, type Task, type TaskStatus } from "@/domain/types";
import { fmtDate } from "@/lib/format";
import { addDays, cx, parseDateStr, toDateStr, todayStr } from "@/lib/util";
import { TaskDialog } from "./TaskDialog";

type View = "list" | "kanban" | "calendar" | "roadmap";

export default function TasksPage() {
  const app = useApp();
  const [params, setParams] = useSearchParams();
  const tasks = useTasks();
  const projects = useProjects();
  const weights = useData(["prefs", "tasks.weights"], () => getPref<PriorityWeights>("tasks.weights", DEFAULT_WEIGHTS));
  const [view, setView] = React.useState<View>(() => (localStorage.getItem("sovare.tasks.view") as View) ?? "list");
  const [scope, setScope] = React.useState<"open" | "today" | "overdue" | "week" | "done" | "all">("open");
  const [projectId, setProjectId] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [editing, setEditing] = React.useState<Task | null>(null);
  const [weightsOpen, setWeightsOpen] = React.useState(false);
  const today = todayStr();

  React.useEffect(() => {
    const id = params.get("task");
    if (id && tasks.data) {
      const t = tasks.data.find((x) => x.id === id);
      if (t) setEditing(t);
    }
  }, [params, tasks.data]);

  const all = (tasks.data ?? []).filter((t) => !t.parent_id);
  const labels = [...new Set(all.flatMap((t) => t.labels))].sort();
  const launchDates = Object.fromEntries((projects.data ?? []).map((p) => [p.id, p.target_launch_on]));
  const w = weights.data ?? DEFAULT_WEIGHTS;
  const filtered = all
    .filter((t) => !projectId || t.project_id === projectId)
    .filter((t) => !label || t.labels.includes(label))
    .filter((t) => {
      const open = !["done", "canceled"].includes(t.status);
      switch (scope) {
        case "open": return open;
        case "today": return open && t.due_on === today;
        case "overdue": return open && !!t.due_on && t.due_on < today;
        case "week": return open && !!t.due_on && t.due_on <= addDays(today, 7);
        case "done": return t.status === "done";
        default: return true;
      }
    });
  const scored = filtered.map((t) => ({ t, s: scoreTask(t, { today, tasks: all, launchDates }, w) })).sort((a, b) => b.s.score - a.s.score);
  const counts = {
    today: all.filter((t) => t.due_on === today && !["done", "canceled"].includes(t.status)).length,
    overdue: all.filter((t) => t.due_on && t.due_on < today && !["done", "canceled"].includes(t.status)).length,
  };

  return (
    <div>
      <PageHeader
        title="Tasks & Roadmap"
        subtitle={`${all.filter((t) => !["done", "canceled"].includes(t.status)).length} pendientes · ${counts.today} para hoy · ${counts.overdue} vencidas`}
        actions={
          <>
            <Segmented value={view} onChange={(v) => (setView(v), localStorage.setItem("sovare.tasks.view", v))} options={[{ value: "list", label: <span className="flex items-center gap-1"><ListOrdered className="size-3.5" />Prioridades</span> }, { value: "kanban", label: <span className="flex items-center gap-1"><Columns3 className="size-3.5" />Kanban</span> }, { value: "calendar", label: <span className="flex items-center gap-1"><CalendarDays className="size-3.5" />Calendario</span> }, { value: "roadmap", label: <span className="flex items-center gap-1"><Map className="size-3.5" />Roadmap</span> }]} />
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => app.openQuick("task", projectId ? { project_id: projectId } : undefined)}>Nueva tarea</Button>
          </>
        }
      />
      {view !== "roadmap" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {view !== "calendar" && (
            <Segmented size="sm" value={scope} onChange={setScope} options={[{ value: "open", label: "Pendientes" }, { value: "today", label: `Hoy (${counts.today})` }, { value: "overdue", label: `Vencidas (${counts.overdue})` }, { value: "week", label: "7 días" }, { value: "done", label: "Hechas" }, { value: "all", label: "Todas" }]} />
          )}
          <Select className="w-48" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Proyecto">
            <option value="">Todos los proyectos</option>
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          {labels.length > 0 && (
            <Select className="w-40" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Etiqueta">
              <option value="">Todas las etiquetas</option>
              {labels.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          )}
          {view === "list" && <Button size="sm" variant="ghost" className="ml-auto" icon={<SlidersHorizontal className="size-3.5" />} onClick={() => setWeightsOpen(true)}>Criterios de Smart Priority</Button>}
        </div>
      )}
      {tasks.isLoading ? <Skeleton className="h-80" /> : (
        <>
          {view === "list" && <ListView items={scored} onOpen={setEditing} />}
          {view === "kanban" && <Kanban tasks={filtered.length || scope !== "open" ? all.filter((t) => (!projectId || t.project_id === projectId) && (!label || t.labels.includes(label))) : all} onOpen={setEditing} />}
          {view === "calendar" && <CalendarView tasks={all.filter((t) => (!projectId || t.project_id === projectId) && (!label || t.labels.includes(label)))} onOpen={setEditing} />}
          {view === "roadmap" && <RoadmapView />}
        </>
      )}
      <TaskDialog open={!!editing} task={editing} onClose={() => (setEditing(null), params.get("task") && setParams({}))} />
      <WeightsDialog open={weightsOpen} onClose={() => setWeightsOpen(false)} weights={w} />
    </div>
  );
}

function TaskRow({ t, score, onOpen, factors }: { t: Task; score?: number; onOpen: (t: Task) => void; factors?: ReturnType<typeof scoreTask> }) {
  const projects = useProjects();
  const tasks = useTasks();
  const toggle = useAction(() => updateTask(t.id, { status: t.status === "done" ? "todo" : "done" }));
  const p = projects.data?.find((x) => x.id === t.project_id);
  const subs = (tasks.data ?? []).filter((x) => x.parent_id === t.id);
  const today = todayStr();
  const overdue = t.due_on && t.due_on < today && t.status !== "done";
  return (
    <div className="group flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0 hover:bg-surface-2/60">
      <button aria-label={t.status === "done" ? "Reabrir" : "Completar"} onClick={() => void toggle.run()}>
        {t.status === "done" ? <CheckCircle2 className="size-[18px] text-success" /> : <Circle className="size-[18px] text-ink-3 hover:text-accent" />}
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(t)}>
        <p className={cx("truncate text-[13px] font-medium", t.status === "done" && "text-ink-3 line-through")}>{t.title}</p>
        <p className="flex items-center gap-2 truncate text-[11.5px] text-ink-3">
          {p && <span className="flex items-center gap-1"><ProjectAvatar project={p} size={14} />{p.name}</span>}
          {t.status !== "todo" && t.status !== "done" && <span>{TASK_STATUS_LABEL[t.status]}</span>}
          {subs.length > 0 && <span>{subs.filter((s) => s.status === "done").length}/{subs.length} subtareas</span>}
          {t.labels.slice(0, 3).map((l) => <span key={l} className="rounded bg-surface-3 px-1">{l}</span>)}
          {t.external_ref && <span>GitHub {t.external_ref.split("/").pop()}</span>}
        </p>
      </button>
      {t.due_on && <span className={cx("shrink-0 text-[12px]", overdue ? "font-medium text-danger" : t.due_on === today ? "text-warning" : "text-ink-3")}>{overdue && <AlertCircle className="mr-1 inline size-3" />}{t.due_on === today ? "Hoy" : fmtDate(t.due_on, "d MMM")}</span>}
      <Badge tone={t.priority === "urgent" ? "danger" : t.priority === "high" ? "warning" : "neutral"}>{TASK_PRIORITY_LABEL[t.priority]}</Badge>
      {score !== undefined && factors && (
        <Tip content={<div className="space-y-0.5"><p className="mb-1 font-medium text-ink">Smart Priority {score}/100{factors.blocked ? " (bloqueada: ×0,5)" : ""}</p>{factors.factors.map((f) => <p key={f.key} className="flex justify-between gap-4"><span>{FACTOR_LABEL[f.key]} ×{f.weight}</span><span>{f.note}</span></p>)}</div>}>
          <span className="w-12 shrink-0 cursor-help text-right">
            <span className={cx("inline-block rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold tabular", score >= 70 ? "bg-danger-soft text-danger" : score >= 45 ? "bg-warning-soft text-warning" : "bg-surface-3 text-ink-2")}>{score}</span>
          </span>
        </Tip>
      )}
    </div>
  );
}

function ListView({ items, onOpen }: { items: Array<{ t: Task; s: ReturnType<typeof scoreTask> }>; onOpen: (t: Task) => void }) {
  if (!items.length) return <Card><EmptyState icon={<CheckCircle2 />} title="No hay tareas en esta vista" body="Creá una tarea o cambiá los filtros." /></Card>;
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[11.5px] text-ink-3">
        <span>Ordenadas por Smart Priority (pasá el cursor sobre el puntaje para ver los criterios)</span>
        <span>Puntaje</span>
      </div>
      {items.map(({ t, s }) => <TaskRow key={t.id} t={t} score={s.score} factors={s} onOpen={onOpen} />)}
    </Card>
  );
}

const COLUMNS: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];

function Kanban({ tasks, onOpen }: { tasks: Task[]; onOpen: (t: Task) => void }) {
  const projects = useProjects();
  const move = useAction((id: string, status: TaskStatus) => updateTask(id, { status }));
  const [over, setOver] = React.useState<TaskStatus | null>(null);
  const recentDone = (t: Task) => t.status !== "done" || (t.completed_at ?? "") >= addDays(todayStr(), -14);
  return (
    <div className="grid grid-cols-4 gap-3">
      {COLUMNS.map((col) => {
        const list = tasks.filter((t) => t.status === col && recentDone(t));
        return (
          <div
            key={col}
            onDragOver={(e) => (e.preventDefault(), setOver(col))}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/task");
              if (id) void move.run(id, col);
            }}
            className={cx("flex min-h-96 flex-col rounded-xl border bg-surface-2/50 p-2 transition-colors", over === col ? "border-accent bg-accent-soft" : "border-line")}
            aria-label={`Columna ${TASK_STATUS_LABEL[col]}`}
          >
            <div className="flex items-center justify-between px-1.5 pb-2 pt-1">
              <span className="text-[12.5px] font-semibold">{TASK_STATUS_LABEL[col]}</span>
              <span className="text-[11.5px] text-ink-3">{list.length}</span>
            </div>
            <div className="space-y-2">
              {list.map((t) => {
                const p = projects.data?.find((x) => x.id === t.project_id);
                return (
                  <div key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/task", t.id)} onClick={() => onOpen(t)} className="cursor-grab rounded-lg border border-line bg-surface p-2.5 shadow-[var(--shadow-sm)] active:cursor-grabbing">
                    <p className="text-[12.5px] font-medium leading-snug">{t.title}</p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-3">
                      <span className="flex min-w-0 items-center gap-1 truncate">{p && <ProjectAvatar project={p} size={14} />}{p?.name ?? "Sin proyecto"}</span>
                      {t.due_on && <span className={cx(t.due_on < todayStr() && t.status !== "done" && "text-danger")}>{fmtDate(t.due_on, "d MMM")}</span>}
                    </div>
                  </div>
                );
              })}
              {!list.length && <p className="px-2 py-6 text-center text-[11.5px] text-ink-3">Arrastrá tareas acá</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CalendarView({ tasks, onOpen }: { tasks: Task[]; onOpen: (t: Task) => void }) {
  const [cursor, setCursor] = React.useState(() => todayStr().slice(0, 7));
  const first = parseDateStr(cursor + "-01");
  const startOffset = (first.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first);
    d.setDate(1 - startOffset + i);
    return toDateStr(d);
  });
  const shift = (n: number) => {
    const d = new Date(first);
    d.setMonth(d.getMonth() + n);
    setCursor(toDateStr(d).slice(0, 7));
  };
  const today = todayStr();
  const noDate = tasks.filter((t) => !t.due_on && !["done", "canceled"].includes(t.status)).length;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <p className="text-[14px] font-semibold capitalize">{fmtDate(cursor + "-01", "MMMM yyyy")}</p>
        <div className="flex items-center gap-1">
          <span className="mr-2 text-[12px] text-ink-3">{noDate} pendientes sin fecha</span>
          <Button size="sm" variant="ghost" icon={<ChevronLeft className="size-4" />} onClick={() => shift(-1)} aria-label="Mes anterior" />
          <Button size="sm" onClick={() => setCursor(today.slice(0, 7))}>Hoy</Button>
          <Button size="sm" variant="ghost" icon={<ChevronRight className="size-4" />} onClick={() => shift(1)} aria-label="Mes siguiente" />
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-line text-center text-[11px] font-medium text-ink-3">
        {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = tasks.filter((t) => t.due_on === d);
          const inMonth = d.startsWith(cursor);
          return (
            <div key={d} className={cx("min-h-24 border-b border-r border-line p-1.5", !inMonth && "bg-surface-2/50")}>
              <p className={cx("mb-1 text-[11.5px]", d === today ? "inline-flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-fg" : inMonth ? "text-ink-2" : "text-ink-3")}>{Number(d.slice(8))}</p>
              {list.slice(0, 3).map((t) => (
                <button key={t.id} onClick={() => onOpen(t)} className={cx("mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left text-[11px]", t.status === "done" ? "bg-success-soft text-success line-through" : d < today ? "bg-danger-soft text-danger" : "bg-accent-soft text-ink")}>
                  {t.title}
                </button>
              ))}
              {list.length > 3 && <p className="text-[10.5px] text-ink-3">+{list.length - 3} más</p>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RoadmapView() {
  const projects = useProjects();
  const tasks = useTasks();
  const ms = useMilestones();
  const list = (projects.data ?? []).filter((p) => p.status !== "archived");
  if (!list.length) return <Card><EmptyState title="Sin proyectos" /></Card>;
  return (
    <div className="space-y-3">
      {list.map((p) => {
        const pms = (ms.data ?? []).filter((m) => m.project_id === p.id);
        const pt = (tasks.data ?? []).filter((t) => t.project_id === p.id && !t.parent_id && t.status !== "canceled");
        if (!pms.length && !pt.length) return null;
        const done = pt.filter((t) => t.status === "done").length;
        return (
          <Card key={p.id}>
            <CardHeader title={p.name} icon={<ProjectAvatar project={p} size={18} />} subtitle={`${done}/${pt.length} tareas · ${pms.length} hitos${p.target_launch_on ? ` · lanzamiento ${fmtDate(p.target_launch_on)}` : ""}`} />
            <div className="flex gap-3 overflow-x-auto px-4 pb-4">
              {pms.map((m) => {
                const mt = pt.filter((t) => t.milestone_id === m.id);
                const md = mt.filter((t) => t.status === "done").length;
                return (
                  <div key={m.id} className={cx("w-56 shrink-0 rounded-lg border p-3", m.status === "done" ? "border-success/40 bg-success-soft/50" : "border-line")}>
                    <p className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Flag className="size-3.5 text-ink-3" />{m.title}</p>
                    <p className="mb-2 text-[11.5px] text-ink-3">{m.due_on ? fmtDate(m.due_on) : "Sin fecha"} · {mt.length ? `${md}/${mt.length}` : "sin tareas"}</p>
                    <Progress value={mt.length ? (md / mt.length) * 100 : m.status === "done" ? 100 : 0} tone={m.due_on && m.due_on < todayStr() && m.status !== "done" ? "danger" : "accent"} />
                  </div>
                );
              })}
              {!pms.length && <p className="text-[12.5px] text-ink-3">{pt.length} tareas sin hitos. Definí hitos en la ficha del proyecto para ver el roadmap.</p>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function WeightsDialog({ open, onClose, weights }: { open: boolean; onClose: () => void; weights: PriorityWeights }) {
  const [w, setW] = React.useState(weights);
  React.useEffect(() => setW(weights), [weights, open]);
  const save = useAction(() => setPref("tasks.weights", w), { success: "Criterios actualizados" });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Criterios de Smart Priority" description="Peso de cada factor (0 = ignorar). El puntaje siempre muestra qué factores influyeron." footer={<><Button onClick={() => setW(DEFAULT_WEIGHTS)}>Restablecer</Button><Button variant="primary" onClick={async () => (await save.run(), onClose())}>Guardar</Button></>}>
      <div className="space-y-3 pb-3">
        {(Object.keys(FACTOR_LABEL) as Array<keyof PriorityWeights>).map((k) => (
          <Field key={k} label={`${FACTOR_LABEL[k]} · ${w[k]}`}>
            <Input type="range" min={0} max={5} step={1} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="h-6 border-0 px-0 shadow-none focus:shadow-none" />
          </Field>
        ))}
      </div>
    </Dialog>
  );
}

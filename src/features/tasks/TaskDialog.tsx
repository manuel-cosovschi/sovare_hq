import * as React from "react";
import { Plus, Trash2, ExternalLink } from "lucide-react";
import { Button, Dialog, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { useAction } from "@/app/hooks";
import { useMilestones, useProjects, useTasks } from "@/app/queries";
import { createTask, deleteTask, updateTask } from "@/repos/tasks";
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, type Task, type TaskPriority, type TaskStatus } from "@/domain/types";
import { useToast } from "@/components/ui/feedback";
import { openUrl } from "@/platform/files";
import { cx } from "@/lib/util";

const LEVELS = [1, 2, 3, 4, 5];

export function TaskDialog({ open, onClose, task, preset }: { open: boolean; onClose: () => void; task?: Task | null; preset?: Partial<Task> }) {
  const projects = useProjects();
  const tasks = useTasks();
  const milestones = useMilestones();
  const toast = useToast();
  const [f, setF] = React.useState({ title: "", description: "", project_id: "", milestone_id: "", status: "todo" as TaskStatus, priority: "medium" as TaskPriority, due_on: "", labels: "", impact: "", effort: "", risk: "", depends_on: [] as string[] });
  const [sub, setSub] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const t = task ?? preset ?? {};
    setError(null);
    setF({
      title: t.title ?? "",
      description: t.description ?? "",
      project_id: t.project_id ?? "",
      milestone_id: t.milestone_id ?? "",
      status: (t.status as TaskStatus) ?? "todo",
      priority: (t.priority as TaskPriority) ?? "medium",
      due_on: t.due_on ?? "",
      labels: (t.labels ?? []).join(", "),
      impact: t.impact ? String(t.impact) : "",
      effort: t.effort ? String(t.effort) : "",
      risk: t.risk ? String(t.risk) : "",
      depends_on: t.depends_on ?? [],
    });
  }, [open, task, preset]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const payload = () => ({
    title: f.title,
    description: f.description || null,
    project_id: f.project_id || null,
    milestone_id: f.milestone_id || null,
    status: f.status,
    priority: f.priority,
    due_on: f.due_on || null,
    labels: f.labels.split(",").map((s) => s.trim()).filter(Boolean),
    impact: f.impact ? Number(f.impact) : null,
    effort: f.effort ? Number(f.effort) : null,
    risk: f.risk ? Number(f.risk) : null,
    depends_on: f.depends_on,
    parent_id: task?.parent_id ?? preset?.parent_id ?? null,
  });
  const save = useAction(async () => (task ? updateTask(task.id, payload()) : createTask(payload())), { success: task ? "Tarea actualizada" : "Tarea creada" });
  const remove = useAction(async () => task && deleteTask(task.id), { success: "Tarea eliminada" });
  const addSub = useAction(async (title: string) => createTask({ title, parent_id: task!.id, project_id: task!.project_id }));
  const toggleSub = useAction(async (t: Task) => updateTask(t.id, { status: t.status === "done" ? "todo" : "done" }));

  const subtasks = task ? (tasks.data ?? []).filter((t) => t.parent_id === task.id) : [];
  const depCandidates = (tasks.data ?? []).filter((t) => t.id !== task?.id && !t.parent_id && t.status !== "canceled" && (!f.project_id || t.project_id === f.project_id));
  const ms = (milestones.data ?? []).filter((m) => m.project_id === f.project_id);

  const submit = async () => {
    if (!f.title.trim()) return setError("El título es obligatorio");
    await save.run();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={task ? "Editar tarea" : preset?.parent_id ? "Nueva subtarea" : "Nueva tarea"}
      width={620}
      footer={
        <>
          {task && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              icon={<Trash2 className="size-3.5" />}
              onClick={async () => {
                if (await toast.confirm({ title: "¿Eliminar tarea?", body: "También se eliminan sus subtareas.", danger: true, confirmLabel: "Eliminar" })) {
                  await remove.run();
                  onClose();
                }
              }}
            >
              Eliminar
            </Button>
          )}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.pending} onClick={() => void submit()}>
            {task ? "Guardar" : "Crear tarea"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5 pb-2">
        <Field label="Título" error={error}>
          <Input autoFocus value={f.title} onChange={(e) => (set("title", e.target.value), setError(null))} onKeyDown={(e) => e.key === "Enter" && void submit()} placeholder="¿Qué hay que hacer?" />
        </Field>
        <Field label="Descripción">
          <Textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Proyecto">
            <Select value={f.project_id} onChange={(e) => (set("project_id", e.target.value), set("milestone_id", ""))}>
              <option value="">Sin proyecto</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Hito">
            <Select value={f.milestone_id} onChange={(e) => set("milestone_id", e.target.value)} disabled={!ms.length}>
              <option value="">{ms.length ? "Sin hito" : "Sin hitos en el proyecto"}</option>
              {ms.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </Select>
          </Field>
          <Field label="Fecha límite">
            <Input type="date" value={f.due_on} onChange={(e) => set("due_on", e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Estado">
            <Select value={f.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
              {Object.entries(TASK_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Prioridad">
            <Select value={f.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)}>
              {Object.entries(TASK_PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Etiquetas" hint="Separadas por coma">
            <Input value={f.labels} onChange={(e) => set("labels", e.target.value)} placeholder="backend, lanzamiento" />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {(["impact", "effort", "risk"] as const).map((k) => (
            <Field key={k} label={{ impact: "Impacto comercial", effort: "Esfuerzo estimado", risk: "Riesgo" }[k]} hint="1 = bajo · 5 = alto">
              <Select value={f[k]} onChange={(e) => set(k, e.target.value)}>
                <option value="">Sin dato</option>
                {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </Field>
          ))}
        </div>
        {depCandidates.length > 0 && (
          <Field label="Depende de" hint="Una tarea bloqueada por otra abierta baja su Smart Priority.">
            <div className="max-h-28 overflow-y-auto rounded-[7px] border border-line p-1.5">
              {depCandidates.slice(0, 40).map((t) => (
                <label key={t.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-[12.5px] hover:bg-surface-2">
                  <input type="checkbox" checked={f.depends_on.includes(t.id)} onChange={(e) => set("depends_on", e.target.checked ? [...f.depends_on, t.id] : f.depends_on.filter((x) => x !== t.id))} />
                  <span className={cx(t.status === "done" && "text-ink-3 line-through")}>{t.title}</span>
                </label>
              ))}
            </div>
          </Field>
        )}
        {task && (
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-ink-2">Subtareas</p>
            <div className="space-y-1">
              {subtasks.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={s.status === "done"} onChange={() => void toggleSub.run(s)} />
                  <span className={cx(s.status === "done" && "text-ink-3 line-through")}>{s.title}</span>
                </label>
              ))}
              <div className="flex gap-2 pt-1">
                <Input
                  placeholder="Agregar subtarea y presionar Enter"
                  value={sub}
                  onChange={(e) => setSub(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && sub.trim()) {
                      await addSub.run(sub.trim());
                      setSub("");
                    }
                  }}
                />
                <Button icon={<Plus className="size-3.5" />} aria-label="Agregar subtarea" disabled={!sub.trim()} onClick={async () => (await addSub.run(sub.trim()), setSub(""))} />
              </div>
            </div>
          </div>
        )}
        {task?.external_url && (
          <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => void openUrl(task.external_url!)}>
            Ver issue en GitHub ({task.external_ref}) — solo lectura
          </Button>
        )}
      </div>
    </Dialog>
  );
}

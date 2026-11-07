import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Button, Dialog, Field, Input, Select, Textarea, Tabs } from "@/components/ui/primitives";
import { ProjectAvatar } from "@/components/common";
import { useAction } from "@/app/hooks";
import { createProject, updateProject, type ProjectInput } from "@/repos/projects";
import { PRIORITY_LABEL, PROJECT_STATUSES, PROJECT_TYPES, STATUS_LABEL, TYPE_LABEL, type Project } from "@/domain/types";

type Form = Record<string, string>;
const LIST_FIELDS = ["languages", "frameworks", "environments", "dependencies"];
const COLORS = ["#1D2E47", "#3F8F8C", "#8A5A44", "#5B6B8C", "#7A6A3A", "#4E6B5A", "#6B4E71", "#2F6690"];

function toForm(p?: Partial<Project> | null): Form {
  const f: Form = {};
  const keys = ["name", "description", "icon", "color", "type", "category", "status", "priority", "target_launch_on", "monetization_model", "pricing_notes", "database_tech", "architecture", "hosting", "domain", "local_path", "docs_url", "notes", ...LIST_FIELDS];
  for (const k of keys) {
    const v = (p as Record<string, unknown> | null | undefined)?.[k];
    f[k] = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
  }
  f.type ||= "saas";
  f.status ||= "idea";
  f.priority ||= "medium";
  return f;
}

export function ProjectDialog({ open, onClose, project, preset }: { open: boolean; onClose: () => void; project?: Project | null; preset?: Partial<Project> }) {
  const nav = useNavigate();
  const [f, setF] = React.useState<Form>(toForm());
  const [tab, setTab] = React.useState<"general" | "tech" | "business" | "ops">("general");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setF(toForm(project ?? preset));
      setTab("general");
      setError(null);
    }
  }, [open, project, preset]);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = useAction(
    async () => {
      const input: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f)) input[k] = LIST_FIELDS.includes(k) ? v.split(",").map((x) => x.trim()).filter(Boolean) : v.trim() === "" ? null : v.trim();
      input.type = f.type;
      input.status = f.status;
      input.priority = f.priority;
      if (project) {
        await updateProject(project.id, input as Partial<ProjectInput>);
        return project.id;
      }
      return createProject({ ...(input as ProjectInput), source: (preset?.source as string) ?? "manual" });
    },
    { success: project ? "Proyecto actualizado" : "Proyecto creado" },
  );

  const submit = async () => {
    if (!f.name.trim()) return setError("El nombre es obligatorio");
    if (f.docs_url && !/^https?:\/\//.test(f.docs_url)) return setError("La URL de documentación debe empezar con http(s)://");
    const id = await save.run();
    if (id) {
      onClose();
      if (!project) nav(`/projects/${id}`);
    }
  };

  const text = (k: string, label: string, ph?: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input value={f[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={project ? `Editar ${project.name}` : "Nuevo proyecto"}
      width={660}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.pending} onClick={() => void submit()}>
            {project ? "Guardar" : "Crear proyecto"}
          </Button>
        </>
      }
    >
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "general", label: "General" }, { value: "tech", label: "Tecnología" }, { value: "business", label: "Negocio" }, { value: "ops", label: "Operaciones" }]} />
      <div className="space-y-3.5 pb-2">
        {tab === "general" && (
          <>
            <div className="flex items-end gap-3">
              <ProjectAvatar project={{ name: f.name || "?", icon: f.icon || null, color: f.color || null, logo_data: null }} size={40} />
              <Field label="Nombre" error={error} className="flex-1">
                <Input autoFocus value={f.name} onChange={(e) => (set("name", e.target.value), setError(null))} placeholder="p. ej. GastroOS" />
              </Field>
              <Field label="Isotipo" hint="1–2 caracteres o emoji" className="w-28">
                <Input maxLength={4} value={f.icon} onChange={(e) => set("icon", e.target.value)} />
              </Field>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="mr-1 text-[12px] text-ink-3">Color</span>
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => set("color", c)} className="size-5 rounded-full ring-offset-2 ring-offset-surface" style={{ background: c, boxShadow: f.color === c ? `0 0 0 2px ${c}` : undefined }} />
              ))}
            </div>
            <Field label="Descripción">
              <Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Tipo">
                <Select value={f.type} onChange={(e) => set("type", e.target.value)}>
                  {PROJECT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </Select>
              </Field>
              <Field label="Estado">
                <Select value={f.status} onChange={(e) => set("status", e.target.value)}>
                  {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </Select>
              </Field>
              <Field label="Prioridad">
                <Select value={f.priority} onChange={(e) => set("priority", e.target.value)}>
                  {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {text("category", "Categoría", "p. ej. Gastronomía")}
              <Field label="Fecha objetivo de lanzamiento">
                <Input type="date" value={f.target_launch_on} onChange={(e) => set("target_launch_on", e.target.value)} />
              </Field>
            </div>
            {text("docs_url", "Documentación (URL)", "https://")}
            <Field label="Notas">
              <Textarea rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
            </Field>
          </>
        )}
        {tab === "tech" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {text("languages", "Lenguajes", "TypeScript, Python", "Separados por coma")}
              {text("frameworks", "Frameworks", "Next.js, Tauri")}
              {text("database_tech", "Base de datos", "PostgreSQL")}
              {text("hosting", "Hosting", "Vercel, Railway")}
              {text("environments", "Entornos", "production, staging")}
              {text("dependencies", "Dependencias relevantes", "Stripe, OpenAI")}
            </div>
            {text("local_path", "Carpeta local", "/Users/vos/dev/proyecto", "Se usa para abrir en Finder / VS Code (debe estar dentro de una carpeta autorizada).")}
            <Field label="Arquitectura">
              <Textarea rows={3} value={f.architecture} onChange={(e) => set("architecture", e.target.value)} />
            </Field>
          </>
        )}
        {tab === "business" && (
          <>
            {text("monetization_model", "Modelo de monetización", "Suscripción mensual, comisión, venta única…")}
            <Field label="Planes y precios">
              <Textarea rows={4} value={f.pricing_notes} onChange={(e) => set("pricing_notes", e.target.value)} placeholder="Básico USD 19/mes · Pro USD 49/mes" />
            </Field>
            <p className="text-[12px] text-ink-3">Ingresos, gastos, MRR y clientes se calculan desde transacciones y métricas registradas, no se cargan acá.</p>
          </>
        )}
        {tab === "ops" && (
          <>
            {text("domain", "Dominio", "gastroos.app")}
            <p className="text-[12px] text-ink-3">Servicios, vencimientos y health checks se administran en Finance → Recurrentes y Development → Monitoring.</p>
          </>
        )}
      </div>
    </Dialog>
  );
}

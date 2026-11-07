import { db } from "@/db";
import type { Milestone, Task } from "@/domain/types";
import { nowIso, uid } from "@/lib/util";
import { audit, insert, jsonCol, logActivity, mapRow, onlyProvided, updateById } from "./core";
import { z } from "zod";

const toTask = (r: Record<string, unknown>) => mapRow<Task>(r as never, { json: ["labels", "depends_on"] });

const level = z.number().int().min(1).max(5).nullish();
export const taskInput = z.object({
  title: z.string().trim().min(1, "El título es obligatorio").max(300),
  description: z.string().max(10000).nullish(),
  project_id: z.string().nullish(),
  milestone_id: z.string().nullish(),
  parent_id: z.string().nullish(),
  status: z.enum(["todo", "in_progress", "blocked", "done", "canceled"]).default("todo"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  labels: z.array(z.string().max(40)).max(20).default([]),
  impact: level,
  effort: level,
  risk: level,
  depends_on: z.array(z.string()).default([]),
});
export type TaskInput = z.input<typeof taskInput>;

export async function listTasks(): Promise<Task[]> {
  const rows = await db().select("SELECT * FROM tasks ORDER BY CASE status WHEN 'done' THEN 2 WHEN 'canceled' THEN 3 ELSE 1 END, due_on IS NULL, due_on, sort_order, created_at");
  return rows.map(toTask);
}

export async function getTask(id: string) {
  const rows = await db().select("SELECT * FROM tasks WHERE id = ?", [id]);
  return rows[0] ? toTask(rows[0]) : null;
}

export async function createTask(input: TaskInput, external?: { source: string; ref: string; url?: string | null }) {
  const t = taskInput.parse(input);
  const id = uid();
  const now = nowIso();
  const row = {
    id,
    title: t.title,
    description: t.description ?? null,
    project_id: t.project_id ?? null,
    milestone_id: t.milestone_id ?? null,
    parent_id: t.parent_id ?? null,
    status: t.status,
    priority: t.priority,
    due_on: t.due_on || null,
    labels: jsonCol(t.labels),
    impact: t.impact ?? null,
    effort: t.effort ?? null,
    risk: t.risk ?? null,
    depends_on: jsonCol(t.depends_on),
    external_source: external?.source ?? null,
    external_ref: external?.ref ?? null,
    external_url: external?.url ?? null,
    completed_at: t.status === "done" ? now : null,
    sort_order: Date.now(),
    created_at: now,
    updated_at: now,
  };
  const r = await insert("tasks", row, external ? "OR IGNORE" : "");
  if (!r.changes) return null;
  await audit("task", id, "create", null, row);
  return id;
}

export async function updateTask(id: string, patch: Partial<TaskInput>) {
  const before = await getTask(id);
  if (!before) throw new Error("Tarea no encontrada");
  const p = onlyProvided(taskInput.partial().parse(patch), patch);
  const row: Record<string, string | number | null> = { updated_at: nowIso() };
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    row[k] = Array.isArray(v) ? jsonCol(v) : v === "" ? null : (v as string | number | null);
  }
  if (p.status && p.status !== before.status) {
    row.completed_at = p.status === "done" ? nowIso() : null;
    if (p.status === "done")
      await logActivity({ source: "sovare", type: "task_completed", title: `Tarea completada: ${before.title}`, project_id: before.project_id, external_id: `task_done:${id}:${row.completed_at}` });
  }
  await updateById("tasks", id, row);
  await audit("task", id, "update", before, row);
}

export async function deleteTask(id: string) {
  const before = await getTask(id);
  await db().execute("DELETE FROM tasks WHERE id = ?", [id]);
  await audit("task", id, "delete", before, null);
}

// ---------- milestones ----------
export async function listMilestones(projectId?: string): Promise<Milestone[]> {
  return projectId
    ? db().select<Milestone>("SELECT * FROM milestones WHERE project_id = ? ORDER BY due_on IS NULL, due_on, sort_order", [projectId])
    : db().select<Milestone>("SELECT * FROM milestones ORDER BY due_on IS NULL, due_on, sort_order");
}

export const milestoneInput = z.object({
  project_id: z.string().min(1, "Elegí un proyecto"),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullish(),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  status: z.enum(["planned", "active", "done", "canceled"]).default("planned"),
});

export async function saveMilestone(input: z.input<typeof milestoneInput>, id?: string) {
  const m = milestoneInput.parse(input);
  const row = { ...m, due_on: m.due_on || null, description: m.description ?? null, updated_at: nowIso() };
  if (id) return void (await updateById("milestones", id, row));
  await insert("milestones", { id: uid(), ...row, sort_order: 0, created_at: nowIso() });
}

export async function deleteMilestone(id: string) {
  await db().execute("DELETE FROM milestones WHERE id = ?", [id]);
}

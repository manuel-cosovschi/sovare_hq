import { db } from "@/db";
import type { Project, ProjectLink, Repository } from "@/domain/types";
import { nowIso, slugify, uid } from "@/lib/util";
import { audit, insert, jsonCol, logActivity, mapRow, onlyProvided, updateById } from "./core";
import { z } from "zod";

const JSON_COLS = ["languages", "frameworks", "environments", "dependencies", "scorecard"];
const toProject = (r: Record<string, unknown>) => mapRow<Project>(r as never, { json: JSON_COLS, bool: ["is_candidate"] });

export const projectInput = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(80),
  description: z.string().max(2000).nullish(),
  icon: z.string().max(4).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  type: z.string().default("other"),
  category: z.string().max(80).nullish(),
  status: z.string().default("idea"),
  priority: z.string().default("medium"),
  target_launch_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  monetization_model: z.string().max(200).nullish(),
  pricing_notes: z.string().max(2000).nullish(),
  languages: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  database_tech: z.string().max(120).nullish(),
  architecture: z.string().max(2000).nullish(),
  hosting: z.string().max(120).nullish(),
  environments: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  domain: z.string().max(200).nullish(),
  local_path: z.string().max(1000).nullish(),
  docs_url: z.string().url().nullish().or(z.literal("")),
  notes: z.string().max(10000).nullish(),
  source: z.string().default("manual"),
  organization_id: z.string().nullish(),
});
export type ProjectInput = z.input<typeof projectInput>;

export async function listProjects(): Promise<Project[]> {
  const rows = await db().select("SELECT * FROM projects ORDER BY CASE status WHEN 'archived' THEN 1 ELSE 0 END, name COLLATE NOCASE");
  return rows.map(toProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const rows = await db().select("SELECT * FROM projects WHERE id = ?", [id]);
  return rows[0] ? toProject(rows[0]) : null;
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = slugify(base);
  let n = 2;
  while ((await db().select("SELECT 1 FROM projects WHERE slug = ?", [slug])).length) slug = `${slugify(base)}-${n++}`;
  return slug;
}

export async function ensureOrganization(): Promise<string> {
  const rows = await db().select<{ id: string }>("SELECT id FROM organizations ORDER BY created_at LIMIT 1");
  if (rows[0]) return rows[0].id;
  const id = uid();
  await insert("organizations", { id, name: "Sovare", description: "Marca y ecosistema de software", created_at: nowIso() });
  return id;
}

export async function createProject(input: ProjectInput): Promise<string> {
  const p = projectInput.parse(input);
  const id = uid();
  const now = nowIso();
  const orgId = p.organization_id ?? (await ensureOrganization());
  const row = {
    id,
    organization_id: orgId,
    slug: await uniqueSlug(p.name),
    name: p.name,
    description: p.description ?? null,
    icon: p.icon ?? null,
    color: p.color ?? null,
    type: p.type,
    category: p.category ?? null,
    status: p.status,
    priority: p.priority,
    target_launch_on: p.target_launch_on || null,
    monetization_model: p.monetization_model ?? null,
    pricing_notes: p.pricing_notes ?? null,
    languages: jsonCol(p.languages),
    frameworks: jsonCol(p.frameworks),
    database_tech: p.database_tech ?? null,
    architecture: p.architecture ?? null,
    hosting: p.hosting ?? null,
    environments: jsonCol(p.environments),
    dependencies: jsonCol(p.dependencies),
    domain: p.domain ?? null,
    local_path: p.local_path ?? null,
    docs_url: p.docs_url || null,
    notes: p.notes ?? null,
    source: p.source,
    created_at: now,
    updated_at: now,
  };
  await insert("projects", row);
  await audit("project", id, "create", null, row);
  await logActivity({ source: "sovare", type: "project_added", title: `Proyecto agregado: ${p.name}`, project_id: id, external_id: `project_added:${id}` });
  return id;
}

export async function updateProject(id: string, patch: Partial<ProjectInput> & { scorecard?: Project["scorecard"] }) {
  const before = await getProject(id);
  if (!before) throw new Error("Proyecto no encontrado");
  const parsed = onlyProvided(projectInput.partial().parse(patch), patch);
  const row: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v === undefined) continue;
    row[k] = Array.isArray(v) ? jsonCol(v) : v === "" ? null : (v as string);
  }
  if (patch.scorecard) row.scorecard = jsonCol(patch.scorecard);
  row.updated_at = nowIso();
  await updateById("projects", id, row);
  await audit("project", id, "update", before, row);
  if (parsed.status && parsed.status !== before.status)
    await logActivity({ source: "sovare", type: "status_changed", title: `${before.name}: ${before.status} → ${parsed.status}`, project_id: id });
}

export async function deleteProject(id: string) {
  const before = await getProject(id);
  await db().execute("DELETE FROM projects WHERE id = ?", [id]);
  await audit("project", id, "delete", before, null);
}

// ---------- links ----------
export async function listLinks(projectId?: string): Promise<ProjectLink[]> {
  return projectId
    ? db().select<ProjectLink>("SELECT * FROM project_links WHERE project_id = ? ORDER BY kind, created_at", [projectId])
    : db().select<ProjectLink>("SELECT * FROM project_links ORDER BY project_id, kind");
}

export async function addLink(projectId: string, kind: string, url: string, label?: string) {
  const u = z.string().url().parse(url.trim());
  if (!/^https?:/.test(u)) throw new Error("Solo se permiten enlaces http(s)");
  await insert("project_links", { id: uid(), project_id: projectId, kind, url: u, label: label || null, created_at: nowIso() });
}

export async function deleteLink(id: string) {
  await db().execute("DELETE FROM project_links WHERE id = ?", [id]);
}

// ---------- repositories ----------
export async function listRepositories(): Promise<Repository[]> {
  return db().select<Repository>("SELECT * FROM repositories ORDER BY COALESCE(pushed_at, last_commit_at, '') DESC");
}

export interface RepoUpsert {
  canonical_key: string;
  provider: string;
  project_id?: string | null;
  full_name?: string | null;
  html_url?: string | null;
  local_path?: string | null;
  default_branch?: string | null;
  description?: string | null;
  primary_language?: string | null;
  is_private?: boolean | null;
  is_archived?: boolean | null;
  open_issues?: number | null;
  open_prs?: number | null;
  stars?: number | null;
  last_commit_at?: string | null;
  last_commit_sha?: string | null;
  last_commit_message?: string | null;
  pushed_at?: string | null;
}

/** Upsert keyed by canonical_key, never overwriting known values with nulls. */
export async function upsertRepository(r: RepoUpsert): Promise<string> {
  const existing = await db().select<{ id: string }>("SELECT id FROM repositories WHERE canonical_key = ?", [r.canonical_key]);
  const now = nowIso();
  if (existing[0]) {
    const patch: Record<string, string | number | boolean | null> = { updated_at: now, synced_at: now };
    for (const [k, v] of Object.entries(r)) if (v !== undefined && v !== null && k !== "canonical_key") patch[k] = typeof v === "boolean" ? (v ? 1 : 0) : v;
    await updateById("repositories", existing[0].id, patch);
    return existing[0].id;
  }
  const id = uid();
  await insert("repositories", {
    id,
    canonical_key: r.canonical_key,
    provider: r.provider,
    project_id: r.project_id ?? null,
    full_name: r.full_name ?? null,
    html_url: r.html_url ?? null,
    local_path: r.local_path ?? null,
    default_branch: r.default_branch ?? null,
    description: r.description ?? null,
    primary_language: r.primary_language ?? null,
    is_private: r.is_private ?? null,
    is_archived: r.is_archived ?? null,
    open_issues: r.open_issues ?? null,
    open_prs: r.open_prs ?? null,
    stars: r.stars ?? null,
    last_commit_at: r.last_commit_at ?? null,
    last_commit_sha: r.last_commit_sha ?? null,
    last_commit_message: r.last_commit_message ?? null,
    pushed_at: r.pushed_at ?? null,
    synced_at: now,
    created_at: now,
    updated_at: now,
  });
  return id;
}

export async function linkRepository(repoId: string, projectId: string | null) {
  await updateById("repositories", repoId, { project_id: projectId, updated_at: nowIso() });
}

import type { ConnectorDef, SyncContext } from "../types";
import { secureJson } from "@/platform/http";
import { withRetry, nextLink } from "../retry";
import { upsertRepository, listRepositories } from "@/repos/projects";
import { upsertDevItems, type DevItemUpsert } from "@/repos/dev";
import { logActivity, touchProject } from "@/repos/core";
import { createTask } from "@/repos/tasks";
import { parseJson } from "@/lib/util";

const API = "https://api.github.com";
const H = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

interface GhRepo {
  id: number;
  full_name: string;
  html_url: string;
  default_branch: string;
  description: string | null;
  language: string | null;
  private: boolean;
  archived: boolean;
  open_issues_count: number;
  stargazers_count: number;
  pushed_at: string | null;
}

async function gh<T>(path: string) {
  return withRetry(() => secureJson<T>("github", { url: path.startsWith("http") ? path : API + path, headers: H }));
}

async function allRepos(maxPages = 5): Promise<GhRepo[]> {
  const out: GhRepo[] = [];
  let url: string | null = `${API}/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member`;
  for (let i = 0; url && i < maxPages; i++) {
    const r: { data: GhRepo[]; headers: Record<string, string> } = await gh<GhRepo[]>(url);
    out.push(...r.data);
    url = nextLink(r.headers["link"]);
  }
  return out;
}

export const githubConnector: ConnectorDef = {
  id: "github",
  name: "GitHub",
  category: "development",
  description: "Repositorios, commits, issues, pull requests, releases y workflows (solo lectura).",
  availability: "available",
  auth: "token",
  secretKey: "github",
  secretLabel: "Fine-grained personal access token",
  permissions: ["Metadata: read", "Contents: read (commits, releases)", "Issues: read", "Pull requests: read", "Actions: read (workflows)"],
  setup: [
    "GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.",
    "Repository access: elegí los repositorios a monitorear (o todos).",
    "Permisos: Metadata, Contents, Issues, Pull requests y Actions en modo Read-only.",
    "Pegá el token acá. Se guarda en el Llavero de macOS y nunca vuelve a mostrarse.",
    "Después de sincronizar, vinculá cada repositorio con su proyecto en ‘Mapeo’.",
  ],
  docsUrl: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
  limitations: [
    "El detalle (commits, PRs, workflows) se sincroniza solo para repositorios vinculados a un proyecto, para respetar los límites de la API.",
    "Nunca se modifican issues ni repositorios remotos.",
  ],
  incremental: true,
  syncEveryMinutes: 60,
  configFields: [{ key: "detail_limit", label: "Repos con detalle por sincronización", placeholder: "15", help: "Máximo de repositorios vinculados a sincronizar en detalle." }],
  test: async () => {
    const { data } = await gh<{ login: string; name: string | null }>("/user");
    return { ok: true, message: `Conectado como ${data.login}`, accountLabel: data.login };
  },
  listExternal: async () => (await allRepos(3)).map((r) => ({ ref: r.full_name, label: r.full_name, hint: r.pushed_at?.slice(0, 10) })),
  sync: async (ctx: SyncContext) => {
    const me = await gh<{ login: string }>("/user");
    const repos = await allRepos();
    let upserted = 0;
    const warnings: string[] = [];
    for (const r of repos) {
      const key = `github.com/${r.full_name}`.toLowerCase();
      // project match: explicit mapping, or a project whose slug equals the repo name
      const mapped = ctx.projectFor(r.full_name);
      await upsertRepository({
        canonical_key: key,
        provider: "github",
        project_id: mapped,
        full_name: r.full_name,
        html_url: r.html_url,
        default_branch: r.default_branch,
        description: r.description,
        primary_language: r.language,
        is_private: r.private,
        is_archived: r.archived,
        stars: r.stargazers_count,
        pushed_at: r.pushed_at,
      });
      upserted++;
    }
    const cursors = parseJson<Record<string, string>>(ctx.cursor, {});
    const linked = (await listRepositories()).filter((r) => r.provider === "github" && r.project_id && r.full_name);
    const limit = Math.max(1, Number(ctx.config.detail_limit) || 15);
    for (const repo of linked.slice(0, limit)) {
      const full = repo.full_name!;
      const since = cursors[full] ?? new Date(Date.now() - 30 * 86400_000).toISOString();
      const items: DevItemUpsert[] = [];
      try {
        const commits = await gh<Array<{ sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } }; author: { login: string } | null }>>(
          `/repos/${full}/commits?since=${encodeURIComponent(since)}&per_page=30`,
        );
        for (const c of commits.data)
          items.push({ repository_id: repo.id, project_id: repo.project_id, kind: "commit", external_id: `${full}@${c.sha}`, title: c.commit.message.split("\n")[0].slice(0, 200), author: c.author?.login ?? c.commit.author.name, url: c.html_url, created_at_ext: c.commit.author.date, extra: { sha: c.sha } });
        const latest = commits.data[0];
        const pulls = await gh<Array<{ id: number; number: number; title: string; state: string; merged_at: string | null; html_url: string; user: { login: string } | null; created_at: string; updated_at: string; closed_at: string | null; draft: boolean }>>(
          `/repos/${full}/pulls?state=all&sort=updated&direction=desc&per_page=30`,
        );
        for (const p of pulls.data)
          items.push({ repository_id: repo.id, project_id: repo.project_id, kind: "pull_request", external_id: `${full}#pr${p.number}`, number: p.number, title: p.title, state: p.merged_at ? "merged" : p.state, author: p.user?.login, url: p.html_url, created_at_ext: p.created_at, updated_at_ext: p.updated_at, closed_at_ext: p.merged_at ?? p.closed_at, extra: { draft: p.draft } });
        const issues = await gh<Array<{ id: number; number: number; title: string; state: string; html_url: string; user: { login: string } | null; created_at: string; updated_at: string; closed_at: string | null; pull_request?: unknown; labels: Array<{ name: string }> }>>(
          `/repos/${full}/issues?state=all&since=${encodeURIComponent(since)}&per_page=50`,
        );
        for (const i of issues.data.filter((x) => !x.pull_request))
          items.push({ repository_id: repo.id, project_id: repo.project_id, kind: "issue", external_id: `${full}#${i.number}`, number: i.number, title: i.title, state: i.state, author: i.user?.login, url: i.html_url, created_at_ext: i.created_at, updated_at_ext: i.updated_at, closed_at_ext: i.closed_at, extra: { labels: i.labels.map((l) => l.name) } });
        const releases = await gh<Array<{ id: number; tag_name: string; name: string | null; html_url: string; published_at: string | null; created_at: string; draft: boolean; prerelease: boolean }>>(`/repos/${full}/releases?per_page=10`);
        for (const rl of releases.data.filter((x) => !x.draft))
          items.push({ repository_id: repo.id, project_id: repo.project_id, kind: "release", external_id: `${full}@release${rl.id}`, title: rl.name || rl.tag_name, state: rl.prerelease ? "prerelease" : "published", url: rl.html_url, created_at_ext: rl.published_at ?? rl.created_at, extra: { tag: rl.tag_name } });
        try {
          const runs = await gh<{ workflow_runs: Array<{ id: number; name: string; status: string; conclusion: string | null; html_url: string; created_at: string; updated_at: string; head_branch: string; event: string }> }>(`/repos/${full}/actions/runs?per_page=15`);
          for (const w of runs.data.workflow_runs)
            items.push({ repository_id: repo.id, project_id: repo.project_id, kind: "workflow_run", external_id: `${full}@run${w.id}`, title: w.name, state: w.conclusion ?? w.status, url: w.html_url, created_at_ext: w.created_at, updated_at_ext: w.updated_at, extra: { branch: w.head_branch, event: w.event } });
        } catch {
          warnings.push(`${full}: sin permiso de Actions (opcional)`);
        }
        upserted += await upsertDevItems(items);
        // activity + repository summary
        for (const it of items) {
          const when = it.closed_at_ext ?? it.updated_at_ext ?? it.created_at_ext;
          if (it.kind === "commit") await logActivity({ source: "github", type: "commit", title: `Commit en ${full}: ${it.title}`, project_id: repo.project_id, occurred_at: it.created_at_ext, external_id: `gh:${it.external_id}`, url: it.url });
          if (it.kind === "pull_request" && it.state === "merged") await logActivity({ source: "github", type: "pr_merged", title: `PR #${it.number} fusionado: ${it.title}`, project_id: repo.project_id, occurred_at: when, external_id: `gh:${it.external_id}:merged`, url: it.url });
          if (it.kind === "issue" && it.state === "closed") await logActivity({ source: "github", type: "issue_closed", title: `Issue #${it.number} cerrada: ${it.title}`, project_id: repo.project_id, occurred_at: when, external_id: `gh:${it.external_id}:closed`, url: it.url });
          if (it.kind === "release") await logActivity({ source: "github", type: "release", title: `Nuevo release ${it.title} (${full})`, project_id: repo.project_id, occurred_at: it.created_at_ext, external_id: `gh:${it.external_id}`, url: it.url });
          if (it.kind === "workflow_run" && it.state === "failure") await logActivity({ source: "github", type: "workflow_failed", title: `Workflow "${it.title}" falló en ${full}`, project_id: repo.project_id, occurred_at: when, external_id: `gh:${it.external_id}:failed`, url: it.url });
        }
        const openPrs = pulls.data.filter((p) => p.state === "open").length;
        await upsertRepository({
          canonical_key: repo.canonical_key,
          provider: "github",
          open_prs: openPrs,
          open_issues: Math.max(0, (repos.find((x) => x.full_name === full)?.open_issues_count ?? openPrs) - openPrs),
          last_commit_at: latest?.commit.author.date ?? null,
          last_commit_sha: latest?.sha ?? null,
          last_commit_message: latest?.commit.message.split("\n")[0] ?? null,
        });
        if (latest && repo.project_id) await touchProject(repo.project_id, latest.commit.author.date);
        cursors[full] = new Date().toISOString();
      } catch (e) {
        warnings.push(`${full}: ${(e as Error).message}`);
      }
    }
    return {
      fetched: repos.length,
      upserted,
      cursor: JSON.stringify(cursors),
      accountLabel: me.data.login,
      details: `${repos.length} repositorios · ${linked.length} vinculados con detalle`,
      warnings,
    };
  },
};

/** Imports open GitHub issues of a repository as local tasks (read-only on GitHub, no duplicates). */
export async function importIssuesAsTasks(fullName: string, projectId: string | null): Promise<{ created: number; skipped: number }> {
  const { data } = await gh<Array<{ number: number; title: string; body: string | null; html_url: string; pull_request?: unknown; labels: Array<{ name: string }> }>>(
    `/repos/${fullName}/issues?state=open&per_page=100`,
  );
  let created = 0;
  let skipped = 0;
  for (const i of data.filter((x) => !x.pull_request)) {
    const id = await createTask(
      { title: i.title, description: (i.body ?? "").slice(0, 5000) || null, project_id: projectId, labels: ["github", ...i.labels.map((l) => l.name).slice(0, 5)] },
      { source: "github", ref: `${fullName}#${i.number}`, url: i.html_url },
    );
    if (id) created++;
    else skipped++;
  }
  return { created, skipped };
}

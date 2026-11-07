import type { ConnectorDef } from "../types";
import { secureJson } from "@/platform/http";
import { withRetry } from "../retry";
import { upsertDeployments, listDeployments, type DeploymentUpsert } from "@/repos/dev";
import { logActivity } from "@/repos/core";
import type { Deployment } from "@/domain/types";

const vercelStatus = (s: string): Deployment["status"] =>
  ({ READY: "ready", ERROR: "error", BUILDING: "building", QUEUED: "queued", INITIALIZING: "queued", CANCELED: "canceled" } as Record<string, Deployment["status"]>)[s] ?? "unknown";

async function emitDeployActivity(list: DeploymentUpsert[], provider: string) {
  const known = new Set((await listDeployments({ limit: 500 })).filter((d) => d.status === "error" || d.status === "ready").map((d) => d.external_id));
  for (const d of list) {
    if (known.has(d.external_id)) continue;
    if (d.status === "error")
      await logActivity({ source: provider, type: "deploy_failed", title: `Deploy fallido · ${d.provider_project}`, project_id: d.project_id, occurred_at: d.created_at_ext, external_id: `${provider}:${d.external_id}:error`, url: d.inspect_url });
    else if (d.status === "ready" && d.environment === "production")
      await logActivity({ source: provider, type: "deploy", title: `Deploy en producción · ${d.provider_project}`, project_id: d.project_id, occurred_at: d.created_at_ext, external_id: `${provider}:${d.external_id}:ready`, url: d.url });
  }
}

export const vercelConnector: ConnectorDef = {
  id: "vercel",
  name: "Vercel",
  category: "hosting",
  description: "Proyectos y despliegues (estado del build, entorno, commit).",
  availability: "available",
  auth: "token",
  secretKey: "vercel",
  secretLabel: "Access token de Vercel",
  permissions: ["Token con scope del equipo/cuenta (lectura de proyectos y deployments)"],
  setup: ["Vercel → Account Settings → Tokens → Create.", "Si usás un equipo, copiá el Team ID (Settings → General) en la configuración.", "Pegá el token y probá la conexión.", "Vinculá cada proyecto de Vercel con un proyecto de Sovare HQ."],
  docsUrl: "https://vercel.com/docs/rest-api",
  limitations: ["Un deploy READY no significa que la aplicación esté saludable: agregá health checks en Development.", "Vercel no ofrece tokens de solo lectura; el token se usa únicamente para lecturas."],
  incremental: false,
  syncEveryMinutes: 30,
  configFields: [{ key: "team_id", label: "Team ID (opcional)", placeholder: "team_xxx" }],
  test: async (ctx) => {
    const q = ctx.config.team_id ? `?teamId=${encodeURIComponent(ctx.config.team_id)}` : "";
    const { data } = await withRetry(() => secureJson<{ user: { username: string } }>("vercel", { url: `https://api.vercel.com/v2/user${q}` }));
    return { ok: true, message: `Conectado como ${data.user.username}`, accountLabel: data.user.username };
  },
  listExternal: async (ctx) => {
    const q = ctx.config.team_id ? `&teamId=${encodeURIComponent(ctx.config.team_id)}` : "";
    const { data } = await withRetry(() => secureJson<{ projects: Array<{ id: string; name: string; framework: string | null }> }>("vercel", { url: `https://api.vercel.com/v9/projects?limit=100${q}` }));
    return data.projects.map((p) => ({ ref: p.id, label: p.name, hint: p.framework ?? undefined }));
  },
  sync: async (ctx) => {
    const q = ctx.config.team_id ? `&teamId=${encodeURIComponent(ctx.config.team_id)}` : "";
    const { data } = await withRetry(() =>
      secureJson<{ deployments: Array<{ uid: string; name: string; projectId: string; url: string; state?: string; readyState?: string; target: string | null; created: number; ready?: number; inspectorUrl?: string; meta?: Record<string, string> }> }>("vercel", {
        url: `https://api.vercel.com/v6/deployments?limit=60${q}`,
      }),
    );
    const list: DeploymentUpsert[] = data.deployments.map((d) => ({
      project_id: ctx.projectFor(d.projectId),
      provider: "vercel",
      external_id: d.uid,
      provider_project: d.name,
      environment: d.target ?? "preview",
      status: vercelStatus(d.readyState ?? d.state ?? ""),
      url: d.url ? `https://${d.url}` : null,
      inspect_url: d.inspectorUrl ?? null,
      commit_sha: d.meta?.githubCommitSha ?? null,
      commit_message: d.meta?.githubCommitMessage ?? null,
      branch: d.meta?.githubCommitRef ?? null,
      created_at_ext: new Date(d.created).toISOString(),
      finished_at_ext: d.ready ? new Date(d.ready).toISOString() : null,
    }));
    await emitDeployActivity(list, "vercel");
    const n = await upsertDeployments(list);
    return { fetched: list.length, upserted: n, details: `${list.length} deployments` };
  },
};

export const netlifyConnector: ConnectorDef = {
  id: "netlify",
  name: "Netlify",
  category: "hosting",
  description: "Sitios y despliegues.",
  availability: "available",
  auth: "token",
  secretKey: "netlify",
  secretLabel: "Personal access token de Netlify",
  permissions: ["Personal access token (lectura de sites y deploys)"],
  setup: ["Netlify → User settings → Applications → New access token.", "Pegá el token y probá la conexión.", "Vinculá los sitios con tus proyectos para sincronizar sus deploys."],
  docsUrl: "https://docs.netlify.com/api/get-started/",
  limitations: ["Solo se sincronizan deploys de sitios vinculados a un proyecto."],
  incremental: false,
  syncEveryMinutes: 60,
  configFields: [],
  test: async () => {
    const { data } = await withRetry(() => secureJson<{ email: string; full_name: string }>("netlify", { url: "https://api.netlify.com/api/v1/user" }));
    return { ok: true, message: `Conectado como ${data.email}`, accountLabel: data.email };
  },
  listExternal: async () => {
    const { data } = await withRetry(() => secureJson<Array<{ id: string; name: string; url: string }>>("netlify", { url: "https://api.netlify.com/api/v1/sites?per_page=100" }));
    return data.map((s) => ({ ref: s.id, label: s.name, hint: s.url }));
  },
  sync: async (ctx) => {
    const { data: sites } = await withRetry(() => secureJson<Array<{ id: string; name: string }>>("netlify", { url: "https://api.netlify.com/api/v1/sites?per_page=100" }));
    const list: DeploymentUpsert[] = [];
    for (const s of sites.filter((x) => ctx.projectFor(x.id))) {
      const { data } = await withRetry(() =>
        secureJson<Array<{ id: string; state: string; context: string; deploy_ssl_url: string; admin_url: string; commit_ref: string | null; title: string | null; branch: string | null; created_at: string; published_at: string | null }>>("netlify", {
          url: `https://api.netlify.com/api/v1/sites/${s.id}/deploys?per_page=20`,
        }),
      );
      for (const d of data)
        list.push({
          project_id: ctx.projectFor(s.id),
          provider: "netlify",
          external_id: d.id,
          provider_project: s.name,
          environment: d.context === "production" ? "production" : d.context,
          status: d.state === "ready" ? "ready" : d.state === "error" ? "error" : ["building", "processing", "uploading"].includes(d.state) ? "building" : ["new", "enqueued"].includes(d.state) ? "queued" : "unknown",
          url: d.deploy_ssl_url,
          inspect_url: `${d.admin_url}/deploys/${d.id}`,
          commit_sha: d.commit_ref,
          commit_message: d.title,
          branch: d.branch,
          created_at_ext: d.created_at,
          finished_at_ext: d.published_at,
        });
    }
    await emitDeployActivity(list, "netlify");
    const n = await upsertDeployments(list);
    return { fetched: list.length, upserted: n, details: `${list.length} deploys de ${sites.length} sitios` };
  },
};

export const plannedHosting: ConnectorDef[] = [
  {
    id: "railway",
    name: "Railway",
    category: "hosting",
    description: "Servicios y despliegues (API GraphQL).",
    availability: "planned",
    auth: "token",
    permissions: ["Account/Team token"],
    setup: ["Adaptador previsto. Mientras tanto, registrá el health endpoint del servicio en Development → Monitoring."],
    docsUrl: "https://docs.railway.com/reference/public-api",
    limitations: ["No implementado en esta versión: no se muestran datos de Railway."],
    incremental: false,
    configFields: [],
  },
  {
    id: "render",
    name: "Render",
    category: "hosting",
    description: "Servicios y deploys.",
    availability: "planned",
    auth: "token",
    permissions: ["API key"],
    setup: ["Adaptador previsto. Mientras tanto, registrá el health endpoint del servicio en Development → Monitoring."],
    docsUrl: "https://api-docs.render.com/",
    limitations: ["No implementado en esta versión: no se muestran datos de Render."],
    incremental: false,
    configFields: [],
  },
];

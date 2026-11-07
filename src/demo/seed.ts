/**
 * DEMO DATA — written ONLY into the separate demo database (sovare-demo.db / IndexedDB db:demo).
 * Project names are fictional on purpose so demo figures can never be mistaken for real ones.
 */
import { activeProfile, db } from "@/db";
import { createProject, upsertRepository, addLink } from "@/repos/projects";
import { createTransaction, saveRecurring, addRate, saveBudget } from "@/repos/finance";
import { createTask, saveMilestone, listMilestones } from "@/repos/tasks";
import { upsertCampaigns, upsertAdMetrics } from "@/repos/marketing";
import { upsertDeployments, upsertDevItems, saveHealthCheck, listHealthChecks } from "@/repos/dev";
import { upsertObservations } from "@/repos/metrics";
import { logActivity, setPref } from "@/repos/core";
import { evaluateAlerts } from "@/repos/alerts";
import { patchIntegration } from "@/repos/integrations";
import { addDays, nowIso, todayStr, uid } from "@/lib/util";
import { toMinor } from "@/domain/money";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export async function seedDemo() {
  if (activeProfile() !== "demo") throw new Error("Los datos demo solo se cargan en el perfil demo");
  const existing = await db().select<{ n: number }>("SELECT count(*) AS n FROM projects");
  if (existing[0].n > 0) return;
  const r = rng(42);
  const today = todayStr();
  const P = async (name: string, o: Record<string, unknown>) => createProject({ name, source: "demo", ...o } as never);
  const atlas = await P("Atlas CRM (demo)", { type: "saas", category: "CRM para pymes", status: "production", priority: "high", description: "SaaS de gestión comercial ficticio.", monetization_model: "Suscripción mensual", hosting: "Vercel", languages: ["TypeScript"], frameworks: ["Next.js", "Prisma"], database_tech: "PostgreSQL", color: "#1D2E47", domain: "atlas-demo.example" });
  const pico = await P("Pico Store (demo)", { type: "ecommerce", category: "E-commerce", status: "launched", priority: "medium", description: "Tienda online ficticia.", monetization_model: "Venta de productos", hosting: "Netlify", languages: ["TypeScript"], frameworks: ["Astro"], color: "#8A5A44" });
  const lumen = await P("Lumen Notes (demo)", { type: "mobile", category: "Productividad", status: "beta", priority: "high", description: "App móvil ficticia de notas con IA.", target_launch_on: addDays(today, 12), languages: ["TypeScript"], frameworks: ["Expo", "React Native"], color: "#3F8F8C" });
  const orbit = await P("Orbit Bot (demo)", { type: "bot", category: "Finanzas", status: "development", priority: "low", description: "Bot de monitoreo ficticio.", languages: ["Python"], frameworks: ["CCXT"], color: "#5B6B8C" });
  const nova = await P("Nova Bookings (demo)", { type: "saas", category: "Hospitalidad", status: "planning", priority: "medium", description: "Reservas para alojamientos (ficticio).", color: "#4E6B5A" });
  await P("Idea: Quill (demo)", { type: "web", status: "idea", priority: "low", description: "Idea ficticia sin desarrollar." });
  await db().execute("UPDATE projects SET last_activity_at = ? WHERE id = ?", [addDays(today, -34) + "T10:00:00.000Z", orbit]);
  await addLink(atlas, "production", "https://atlas-demo.example");

  // ---- finances (6 months)
  for (let d = 180; d >= 0; d--) {
    const day = addDays(today, -d);
    const growth = 1 + (180 - d) / 180;
    if (r() < 0.55) await createTransaction({ kind: "income", category: "subscriptions", amount_minor: toMinor(Math.round((19 + r() * 60) * growth), "USD"), currency: "USD", occurred_on: day, project_id: atlas, description: "Suscripción Atlas (demo)" }, "demo", { external_id: `demo-a-${d}` });
    if (r() < 0.4) await createTransaction({ kind: "income", category: "sales", amount_minor: toMinor(Math.round(15000 + r() * 40000), "ARS"), currency: "ARS", occurred_on: day, project_id: pico, description: "Pedido Pico (demo)", status: d < 3 ? "pending" : "cleared" }, "demo", { external_id: `demo-p-${d}` });
    if (r() < 0.4) await createTransaction({ kind: "fee", category: "payment_processing", amount_minor: toMinor(Math.round(800 + r() * 2500), "ARS"), currency: "ARS", occurred_on: day, project_id: pico, description: "Comisión procesador (demo)" }, "demo", { external_id: `demo-pf-${d}` });
    if (d % 30 === 0) {
      await createTransaction({ kind: "expense", category: "hosting", amount_minor: toMinor(20, "USD"), currency: "USD", occurred_on: day, project_id: atlas, description: "Hosting (demo)" }, "demo", { external_id: `demo-h-${d}` });
      await createTransaction({ kind: "expense", category: "ai", amount_minor: toMinor(15 + Math.round(r() * 20), "USD"), currency: "USD", occurred_on: day, project_id: lumen, description: "API de IA (demo)" }, "demo", { external_id: `demo-ai-${d}` });
      await createTransaction({ kind: "expense", category: "tools", amount_minor: toMinor(30, "USD"), currency: "USD", occurred_on: day, project_id: null, description: "Herramientas (demo)" }, "demo", { external_id: `demo-t-${d}` });
    }
    if (d % 7 === 0) await createTransaction({ kind: "expense", category: "advertising", amount_minor: toMinor(Math.round(15 + r() * 25), "USD"), currency: "USD", occurred_on: day, project_id: d < 40 ? lumen : atlas, description: "Meta Ads (demo)" }, "demo", { external_id: `demo-ads-${d}` });
  }
  await createTransaction({ kind: "investment", category: "development", amount_minor: toMinor(1200, "USD"), currency: "USD", occurred_on: addDays(today, -150), project_id: lumen, description: "Diseño UI freelance (demo)" }, "demo", { external_id: "demo-inv-1" });
  await createTransaction({ kind: "investment", category: "equipment", amount_minor: toMinor(450, "USD"), currency: "USD", occurred_on: addDays(today, -90), project_id: orbit, description: "Servidor (demo)" }, "demo", { external_id: "demo-inv-2" });
  await createTransaction({ kind: "refund", category: "sales", amount_minor: toMinor(25000, "ARS"), currency: "ARS", occurred_on: addDays(today, -6), project_id: pico, description: "Devolución (demo)" }, "demo", { external_id: "demo-ref-1" });
  await addRate("USD", "ARS", 1450, addDays(today, -1), "Demo (valor ficticio)");
  await saveRecurring({ name: "Vercel Pro (demo)", vendor: "Vercel", category: "hosting", amount_minor: 2000, currency: "USD", interval: "monthly", next_due_on: addDays(today, 4), project_id: atlas });
  await saveRecurring({ name: "Dominio (demo)", vendor: "Registrar", category: "domains", amount_minor: 1500, currency: "USD", interval: "yearly", next_due_on: addDays(today, 40), project_id: pico });
  await saveRecurring({ name: "VPS bot (demo)", vendor: "Hosting", category: "hosting", amount_minor: 600, currency: "USD", interval: "monthly", next_due_on: addDays(today, 15), project_id: orbit });
  await saveBudget(null, today.slice(0, 7), "USD", 25000);

  // ---- tasks & milestones
  await saveMilestone({ project_id: lumen, title: "Beta pública", due_on: addDays(today, 12), status: "active" });
  await saveMilestone({ project_id: nova, title: "MVP", due_on: addDays(today, 60) });
  const ms = await listMilestones();
  const lumenMs = ms.find((m) => m.project_id === lumen)!.id;
  const t1 = await createTask({ title: "Publicar build en TestFlight", project_id: lumen, milestone_id: lumenMs, priority: "urgent", due_on: addDays(today, 2), impact: 5, effort: 2, labels: ["lanzamiento"] });
  await createTask({ title: "Onboarding con IA", project_id: lumen, milestone_id: lumenMs, priority: "high", due_on: addDays(today, 6), impact: 4, effort: 4, depends_on: t1 ? [t1] : [] });
  await createTask({ title: "Política de privacidad", project_id: lumen, milestone_id: lumenMs, status: "done", priority: "medium" });
  await createTask({ title: "Arreglar cálculo de impuestos en checkout", project_id: pico, priority: "high", due_on: addDays(today, -3), impact: 4, effort: 2, labels: ["bug"] });
  await createTask({ title: "Exportar reportes a Excel", project_id: atlas, priority: "medium", due_on: addDays(today, 9), impact: 3, effort: 3 });
  await createTask({ title: "Plan de precios anual", project_id: atlas, priority: "medium", status: "in_progress", impact: 4, effort: 1 });
  await createTask({ title: "Investigar APIs de channel managers", project_id: nova, priority: "low", impact: 2, effort: 3 });
  await createTask({ title: "Revisar estrategia del bot", project_id: orbit, priority: "low", status: "blocked" });
  await createTask({ title: "Renovar certificado de firma", priority: "medium", due_on: today });

  // ---- marketing
  const ids = await upsertCampaigns([
    { platform: "meta_ads", account_id: "act_demo", external_id: "demo-c1", level: "campaign", parent_external_id: null, project_id: atlas, name: "Atlas · Prospecting (demo)", objective: "CONVERSIONS", status: "ACTIVE", daily_budget_minor: 1500, lifetime_budget_minor: null, currency: "USD", start_on: addDays(today, -60), end_on: null, source: "demo" },
    { platform: "meta_ads", account_id: "act_demo", external_id: "demo-c2", level: "campaign", parent_external_id: null, project_id: lumen, name: "Lumen · Waitlist (demo)", objective: "LEADS", status: "ACTIVE", daily_budget_minor: 1000, lifetime_budget_minor: null, currency: "USD", start_on: addDays(today, -30), end_on: null, source: "demo" },
    { platform: "meta_ads", account_id: "act_demo", external_id: "demo-c3", level: "campaign", parent_external_id: null, project_id: pico, name: "Pico · Retargeting (demo)", objective: "SALES", status: "PAUSED", daily_budget_minor: 800, lifetime_budget_minor: null, currency: "USD", start_on: addDays(today, -90), end_on: null, source: "demo" },
  ]);
  const rows = [];
  for (let d = 60; d >= 0; d--) {
    const date = addDays(today, -d);
    rows.push({ campaign_id: ids["demo-c1"], date, impressions: 3000 + Math.round(r() * 2000), reach: 2500, clicks: 40 + Math.round(r() * 30), spend_minor: 1200 + Math.round(r() * 400), currency: "USD", conversions: Math.round(r() * 3), conversion_value_minor: Math.round(r() * 9000), conversion_label: "purchase", source: "demo" });
    if (d <= 30) rows.push({ campaign_id: ids["demo-c2"], date, impressions: 2000 + Math.round(r() * 1000), reach: 1800, clicks: d < 8 ? 6 : 25 + Math.round(r() * 10), spend_minor: 900 + Math.round(r() * 200), currency: "USD", conversions: d < 8 ? 0 : Math.round(r() * 4), conversion_value_minor: null, conversion_label: "lead", source: "demo" });
    if (d > 20) rows.push({ campaign_id: ids["demo-c3"], date, impressions: 1500, reach: 1200, clicks: 20, spend_minor: 700, currency: "USD", conversions: null, conversion_value_minor: null, conversion_label: null, source: "demo" });
  }
  await upsertAdMetrics(rows);

  // ---- development
  const repoA = await upsertRepository({ canonical_key: "github.com/demo/atlas-crm", provider: "github", project_id: atlas, full_name: "demo/atlas-crm", html_url: "https://github.com/", default_branch: "main", primary_language: "TypeScript", open_prs: 2, open_issues: 5, last_commit_at: addDays(today, -1) + "T15:00:00Z", last_commit_message: "feat: export CSV (demo)" });
  const repoL = await upsertRepository({ canonical_key: "github.com/demo/lumen", provider: "github", project_id: lumen, full_name: "demo/lumen", default_branch: "main", primary_language: "TypeScript", open_prs: 1, open_issues: 3, last_commit_at: today + "T09:00:00Z", last_commit_message: "fix: sync offline (demo)" });
  const items = [];
  for (let i = 0; i < 25; i++) items.push({ repository_id: i % 2 ? repoA : repoL, project_id: i % 2 ? atlas : lumen, kind: "commit" as const, external_id: `demo-commit-${i}`, title: ["feat: nueva vista", "fix: bug de sesión", "chore: deps", "refactor: módulo pagos", "docs: README"][i % 5] + " (demo)", author: "demo", created_at_ext: addDays(today, -Math.floor(i / 2)) + "T12:00:00Z" });
  items.push({ repository_id: repoA, project_id: atlas, kind: "pull_request" as const, external_id: "demo-pr-1", number: 41, title: "Exportación a CSV (demo)", state: "merged", created_at_ext: addDays(today, -3) + "T10:00:00Z", closed_at_ext: addDays(today, -2) + "T10:00:00Z" });
  items.push({ repository_id: repoL, project_id: lumen, kind: "workflow_run" as const, external_id: "demo-run-1", title: "CI (demo)", state: "failure", created_at_ext: addDays(today, -1) + "T10:00:00Z" });
  items.push({ repository_id: repoA, project_id: atlas, kind: "release" as const, external_id: "demo-rel-1", title: "v1.8.0 (demo)", state: "published", created_at_ext: addDays(today, -5) + "T10:00:00Z" });
  await upsertDevItems(items);
  await upsertDeployments([
    { project_id: atlas, provider: "vercel", external_id: "demo-dpl-1", provider_project: "atlas-crm", environment: "production", status: "ready", url: null, inspect_url: null, commit_sha: "abc1234", commit_message: "feat: export CSV (demo)", branch: "main", created_at_ext: addDays(today, -1) + "T16:00:00Z", finished_at_ext: null },
    { project_id: lumen, provider: "vercel", external_id: "demo-dpl-2", provider_project: "lumen-web", environment: "preview", status: "error", url: null, inspect_url: null, commit_sha: "def5678", commit_message: "fix: sync offline (demo)", branch: "beta", created_at_ext: today + "T09:30:00Z", finished_at_ext: null },
  ]);
  for (const e of [
    { source: "github", type: "commit", title: "Commit en demo/lumen: fix: sync offline (demo)", project_id: lumen, occurred_at: today + "T09:00:00Z" },
    { source: "vercel", type: "deploy_failed", title: "Deploy fallido · lumen-web (demo)", project_id: lumen, occurred_at: today + "T09:30:00Z" },
    { source: "github", type: "pr_merged", title: "PR #41 fusionado: Exportación a CSV (demo)", project_id: atlas, occurred_at: addDays(today, -2) + "T10:00:00Z" },
    { source: "vercel", type: "deploy", title: "Deploy en producción · atlas-crm (demo)", project_id: atlas, occurred_at: addDays(today, -1) + "T16:00:00Z" },
  ]) await logActivity({ ...e, external_id: `demo-ev-${uid()}` });

  // ---- monitoring & metrics
  await saveHealthCheck({ name: "Atlas API (demo)", url: "https://atlas-demo.example/api/health", project_id: atlas, interval_minutes: 1440, enabled: false });
  const hc = (await listHealthChecks())[0];
  for (let i = 0; i < 40; i++)
    await db().execute("INSERT INTO health_results (id, check_id, checked_at, ok, status_code, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?)", [uid(), hc.id, new Date(Date.now() - (40 - i) * 3600_000).toISOString(), i === 22 ? 0 : 1, i === 22 ? 503 : 200, 120 + Math.round(r() * 80), i === 22 ? "HTTP 503 (demo)" : null]);
  const obs = [];
  for (let d = 30; d >= 0; d--) {
    const day = addDays(today, -d);
    obs.push({ project_id: atlas, metric_key: "active_users", value: 300 + Math.round(r() * 60) + (30 - d) * 3, unit: "count", period_start: day, period_end: day, source: "demo" });
    obs.push({ project_id: atlas, metric_key: "sessions", value: 500 + Math.round(r() * 200), unit: "count", period_start: day, period_end: day, source: "demo" });
  }
  obs.push({ project_id: atlas, metric_key: "mrr", value: 184000, unit: "money", currency: "USD", period_start: today, period_end: today, source: "demo" } as never);
  obs.push({ project_id: atlas, metric_key: "active_subscriptions", value: 76, unit: "count", period_start: today, period_end: today, source: "demo" });
  obs.push({ project_id: atlas, metric_key: "churn_rate", value: 3.4, unit: "percent", period_start: addDays(today, -30), period_end: today, source: "demo" });
  obs.push({ project_id: lumen, metric_key: "installs", value: 412, unit: "count", period_start: addDays(today, -30), period_end: today, source: "demo" });
  await upsertObservations(obs);
  await patchIntegration("github", { status: "connected", enabled: false, last_success_at: nowIso(), account_label: "demo" });
  await setPref("demo.seeded_at", nowIso());
  await evaluateAlerts();
}

const TABLES = ["ai_messages", "ai_insights", "alerts", "alert_rules", "activity_events", "audit_log", "health_results", "health_checks", "deployments", "dev_items", "ad_metrics", "campaigns", "metric_observations", "budgets", "financial_transactions", "recurring_costs", "exchange_rates", "sync_runs", "integration_mappings", "integrations", "tasks", "milestones", "repositories", "project_links", "projects", "organizations", "user_preferences"];

/** Wipes the DEMO database only (refuses to run on real data) and reseeds it. */
export async function resetDemo() {
  if (activeProfile() !== "demo") throw new Error("Solo se puede reiniciar la base de demostración");
  await db().batch(TABLES.map((t) => ({ sql: `DELETE FROM ${t}` })));
  await seedDemo();
}

/** Full JSON export of the active database (it contains no credentials: those live in the Keychain). */
export async function exportAllJson(): Promise<string> {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) out[t] = await db().select(`SELECT * FROM ${t}`);
  return JSON.stringify({ app: "Sovare HQ", exported_at: nowIso(), profile: activeProfile(), tables: out }, null, 2);
}

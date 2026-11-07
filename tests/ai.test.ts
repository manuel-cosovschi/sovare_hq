import { beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers/db";
import { executeTool, toolByName, toolJsonSchema, TOOLS } from "@/ai/tools";
import { generateInsights, topActions, answerPreset } from "@/ai/localEngine";
import { buildDailyBrief } from "@/ai/brief";
import { DATA_CATEGORIES, DEFAULT_AI, assistantAvailability, isExternal, loadAiSettings, saveAiSettings, type DataCategory } from "@/ai/settings";
import { createProject } from "@/repos/projects";
import { createTransaction } from "@/repos/finance";
import { createTask, updateTask } from "@/repos/tasks";
import { formatMoney } from "@/domain/money";
import { addDays, todayStr } from "@/lib/util";

const ALL = Object.fromEntries(Object.keys(DATA_CATEGORIES).map((k) => [k, true])) as Record<DataCategory, boolean>;

beforeEach(async () => {
  await freshDb();
});

async function seed() {
  const today = todayStr();
  const d = (n: number) => addDays(today, -n);
  const gastro = await createProject({ name: "GastroOS", status: "production" });
  const memo = await createProject({ name: "MEMO", status: "beta" });
  await createTransaction({ kind: "income", category: "sales", amount_minor: 100_000, currency: "USD", occurred_on: d(10), project_id: gastro });
  await createTransaction({ kind: "expense", category: "hosting", amount_minor: 20_000, currency: "USD", occurred_on: d(9), project_id: gastro });
  await createTransaction({ kind: "income", category: "sales", amount_minor: 30_000, currency: "USD", occurred_on: d(8), project_id: memo });
  await createTransaction({ kind: "expense", category: "advertising", amount_minor: 50_000, currency: "USD", occurred_on: d(7), project_id: memo });
  await createTransaction({ kind: "income", category: "sales", amount_minor: 5_000_000, currency: "ARS", occurred_on: d(5), project_id: gastro });
  return { gastro, memo, today };
}

describe("executeTool", () => {
  it("validates arguments with zod", async () => {
    const r = await executeTool("getTransactions", { limit: 0, kind: "gift" }, ALL);
    expect(r.ok).toBe(false);
    const issues = (r.result as { issues: string[] }).issues;
    expect(issues.some((i) => i.startsWith("limit"))).toBe(true);
    expect(issues.some((i) => i.startsWith("kind"))).toBe(true);
    expect((await executeTool("getProjectDetails", {}, ALL)).ok).toBe(false);
    expect((await executeTool("getFinancialSummary", { period: "decade" }, ALL)).ok).toBe(false);
  });

  it("refuses tools whose privacy category is disabled", async () => {
    await seed();
    const r = await executeTool("getFinancialSummary", {}, DEFAULT_AI.categories);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.result)).toContain("finance");
    expect(JSON.stringify(r.result)).not.toContain("1000"); // no data leaked in the refusal
    expect((await executeTool("getCampaignPerformance", {}, { ...ALL, marketing: false })).ok).toBe(false);
    expect((await executeTool("listProjects", {}, DEFAULT_AI.categories)).ok).toBe(true);
  });

  it("rejects unknown tools", async () => {
    expect(await executeTool("dropDatabase", {}, ALL)).toMatchObject({ ok: false });
  });

  it("returns per-currency financial data without mixing currencies", async () => {
    await seed();
    const r = await executeTool("getFinancialSummary", { period: "30d" }, ALL);
    expect(r.ok).toBe(true);
    const res = r.result as { current: Record<string, { netRevenue: number; operatingProfit: number }>; previous: Record<string, unknown> };
    expect(Object.keys(res.current).sort()).toEqual(["ARS", "USD"]);
    expect(res.current.USD).toMatchObject({ netRevenue: 1300, operatingProfit: 600 });
    expect(res.current.ARS).toMatchObject({ netRevenue: 50_000 });
    expect(res.previous).toEqual({});
  });

  it("marks results as demo data under the demo profile", async () => {
    await freshDb("demo");
    await createProject({ name: "Demo app" });
    const r = await executeTool("listProjects", {}, ALL);
    expect(r.ok).toBe(true);
    expect(r.result).toMatchObject({ demo_mode: expect.stringContaining("DEMOSTRACIÓN"), data: [expect.objectContaining({ name: "Demo app" })] });
  });

  it("main profile results carry no demo marker", async () => {
    await createProject({ name: "Real app" });
    const r = await executeTool("listProjects", {}, ALL);
    expect(Array.isArray(r.result)).toBe(true);
  });
});

describe("toolJsonSchema", () => {
  it("produces an object schema for every tool", () => {
    for (const t of TOOLS) {
      const s = toolJsonSchema(t);
      expect(s.type).toBe("object");
      expect(s).not.toHaveProperty("$schema");
    }
    const s = toolJsonSchema(toolByName("getTransactions")!) as { properties: Record<string, { enum?: string[] }>; required?: string[] };
    expect(Object.keys(s.properties)).toEqual(expect.arrayContaining(["from", "to", "projectId", "kind", "limit"]));
    expect(s.properties.kind.enum).toEqual(["income", "expense", "refund", "fee", "investment"]);
    expect(s.required ?? []).not.toContain("limit"); // has a default
    expect((toolJsonSchema(toolByName("getProjectDetails")!) as { required: string[] }).required).toEqual(["projectId"]);
  });
});

describe("local insight engine", () => {
  it("on an empty database only suggests connecting data and never invents numbers", async () => {
    const insights = await generateInsights();
    expect(insights.map((i) => i.id).sort()).toEqual(["data:ads", "data:finance", "data:github", "data:projects"]);
    for (const i of insights) {
      expect(i.topic).toBe("data");
      expect(i.evidence).toEqual([]);
      expect(i.impact).toBeNull();
      expect(i.recommendation).not.toMatch(/USD|ARS|\$|%/);
    }
    const profit = await answerPreset("profit");
    expect(profit.insights).toEqual([]);
    expect(profit.empty).toMatch(/No hay ingresos/);
  });

  it("reports the most profitable project with evidence from recorded data", async () => {
    const { gastro, memo, today } = await seed();
    const insights = await generateInsights(today);
    const best = insights.find((i) => i.id === "profit:USD")!;
    expect(best.recommendation).toContain("GastroOS");
    expect(best.type).toBe("hecho");
    expect(best.link).toBe(`/projects/${gastro}`);
    expect(best.evidence).toContain(`Beneficio ${formatMoney(80_000, "USD")}`);
    expect(insights.find((i) => i.id === "profit:ARS")!.recommendation).toContain("GastroOS");

    const loss = insights.find((i) => i.id === `loss:USD:${memo}`)!;
    expect(loss.recommendation).toContain("MEMO");
    expect(loss.type).toBe("estimación");

    expect(insights.find((i) => i.id === "conc:USD")).toBeTruthy(); // 100k of 130k
    expect(insights.find((i) => i.id === "spend:USD")!.recommendation).toMatch(/71% .*Publicidad/);
    expect(insights.some((i) => i.id === "data:finance" || i.id === "data:projects")).toBe(false);
    // sorted by weight
    for (let k = 1; k < insights.length; k++) expect(insights[k - 1].weight).toBeGreaterThanOrEqual(insights[k].weight);
    expect(topActions(insights).length).toBeLessThanOrEqual(3);
  });

  it("flags stale active projects from recorded activity only", async () => {
    const id = await createProject({ name: "FitNow", status: "development" });
    const { db } = await import("@/db");
    await db().execute("UPDATE projects SET last_activity_at = ? WHERE id = ?", [`${addDays(todayStr(), -40)}T10:00:00.000Z`, id]);
    const insights = await generateInsights();
    expect(insights.find((i) => i.id === `stale:${id}`)!.recommendation).toContain("40 días");
  });
});

describe("daily brief", () => {
  it("is empty when nothing happened", async () => {
    const b = await buildDailyBrief(null);
    expect(b).toMatchObject({ empty: true, lines: [], events: [], newAlerts: [], resolvedAlerts: 0, tasksCompleted: 0, money: [] });
  });

  it("summarizes recorded events since the last visit", async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const pid = await createProject({ name: "Cerquita" });
    await createTransaction({ kind: "income", amount_minor: 50_000, currency: "USD", occurred_on: todayStr(), project_id: pid });
    await createTransaction({ kind: "expense", category: "hosting", amount_minor: 2_000, currency: "USD", occurred_on: todayStr(), project_id: pid });
    const tid = (await createTask({ title: "Publicar", project_id: pid }))!;
    await updateTask(tid, { status: "done" });
    const b = await buildDailyBrief(since);
    expect(b.empty).toBe(false);
    expect(b.money).toEqual([{ currency: "USD", income: 50_000, expenses: 2_000 }]);
    expect(b.tasksCompleted).toBe(1);
    expect(b.lines).toContain(`Se registraron ${formatMoney(50_000, "USD")} de ingresos netos nuevos.`);
    expect(b.lines).toContain(`Se registraron ${formatMoney(2_000, "USD")} de gastos nuevos.`);
    expect(b.lines).toContain("1 tarea(s) completadas.");
    // a later visit sees nothing new
    const later = await buildDailyBrief(new Date(Date.now() + 1000).toISOString());
    expect(later.empty).toBe(true);
  });
});

describe("AI settings", () => {
  it("defaults keep finance/marketing private and external analysis off", async () => {
    const s = await loadAiSettings();
    expect(s).toEqual(DEFAULT_AI);
    expect(s.categories.finance).toBe(false);
    expect(assistantAvailability(s).ok).toBe(false);
  });

  it("external providers require explicit opt-in; local ollama does not", async () => {
    const cloud = { ...DEFAULT_AI, provider: "anthropic" as const, model: "x" };
    expect(isExternal(cloud)).toBe(true);
    expect(assistantAvailability(cloud).ok).toBe(false);
    expect(assistantAvailability({ ...cloud, externalEnabled: true }).ok).toBe(true);
    const local = { ...DEFAULT_AI, provider: "ollama" as const };
    expect(isExternal(local)).toBe(false);
    expect(assistantAvailability(local).ok).toBe(true);
    expect(isExternal({ ...local, baseUrl: "http://192.168.1.10:11434" })).toBe(true);
    expect(isExternal({ ...local, baseUrl: "not a url" })).toBe(true);
  });

  it("persists settings and merges new categories with defaults", async () => {
    await saveAiSettings({ ...DEFAULT_AI, provider: "openai", categories: { ...DEFAULT_AI.categories, finance: true } });
    const s = await loadAiSettings();
    expect(s.provider).toBe("openai");
    expect(s.categories).toEqual({ ...DEFAULT_AI.categories, finance: true });
  });
});

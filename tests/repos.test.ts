import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { freshDb, reopen, type TestDb } from "./helpers/db";
import { migrate } from "@/db/migrate";
import { db } from "@/db";
import { createProject, deleteProject, getProject, listProjects, listRepositories, updateProject, upsertRepository } from "@/repos/projects";
import { auditTrail, getPref, setPref } from "@/repos/core";
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  importDrafts,
  listImportBatches,
  listRecurring,
  listTransactions,
  markRecurringPaid,
  restoreTransaction,
  saveRecurring,
  undoImport,
  updateTransaction,
  upsertExternalTransactions,
  addRate,
  listRates,
  saveBudget,
  listBudgets,
  type ExternalTx,
} from "@/repos/finance";
import { createTask, getTask, listTasks, updateTask, deleteTask } from "@/repos/tasks";
import { evaluateAlerts, listAlerts, setAlertStatus } from "@/repos/alerts";
import { globalSearch } from "@/repos/search";
import { buildDrafts, parseCsv, detectMapping } from "@/domain/csvImport";
import { updateById } from "@/repos/core";

let t: TestDb;
beforeEach(async () => {
  t = await freshDb();
});

const count = async (sql: string, params: (string | number)[] = []) => (await db().select<{ n: number }>(sql, params))[0].n;

describe("migrations", () => {
  it("apply once and are idempotent", async () => {
    const rows = await db().select<{ version: number; name: string }>("SELECT version, name FROM schema_migrations");
    expect(rows).toEqual([{ version: 1, name: "initial_schema" }]);
    const again = await migrate(db());
    expect(again).toEqual({ from: 1, to: 1, applied: [] });
    expect(await count("SELECT count(*) AS n FROM schema_migrations")).toBe(1);
    const tables = (await db().select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(["projects", "financial_transactions", "tasks", "alerts", "audit_log", "sync_runs", "exchange_rates"]));
  });

  it("a failing migration rolls back and leaves the version untouched", async () => {
    await expect(migrate(db(), [{ version: 2, name: "broken", sql: "CREATE TABLE ok_table (id TEXT); INSERT INTO nope VALUES (1);" }])).rejects.toThrow(/Migration 2/);
    expect(await count("SELECT MAX(version) AS n FROM schema_migrations")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM sqlite_master WHERE name = 'ok_table'")).toBe(0);
  });

  it("enforces schema constraints (CHECK, foreign keys)", async () => {
    await expect(db().execute("INSERT INTO financial_transactions (id, kind, amount_minor, currency, occurred_on, created_at, updated_at) VALUES ('x', 'income', -1, 'USD', '2026-01-01', 'n', 'n')")).rejects.toThrow();
    await expect(db().execute("INSERT INTO milestones (id, project_id, title, created_at, updated_at) VALUES ('m', 'missing', 't', 'n', 'n')")).rejects.toThrow();
  });
});

describe("projects", () => {
  it("creates projects with unique slugs, audit rows and a project_added activity", async () => {
    const a = await createProject({ name: "GastroOS", status: "development", languages: ["TypeScript"] });
    const b = await createProject({ name: "GastroOS" });
    const pa = (await getProject(a))!;
    const pb = (await getProject(b))!;
    expect(pa.slug).toBe("gastroos");
    expect(pb.slug).toBe("gastroos-2");
    expect(pa.languages).toEqual(["TypeScript"]);
    expect(pa.is_candidate).toBe(false);
    expect(pa.organization_id).toBeTruthy();
    expect(pb.organization_id).toBe(pa.organization_id); // a single default organization
    expect(pa.last_activity_at).toBeTruthy();

    const trail = await auditTrail("project", a);
    expect(trail.map((r) => r.action)).toEqual(["create"]);
    expect(JSON.parse(trail[0].after!).name).toBe("GastroOS");
    const ev = await db().select<{ type: string; project_id: string }>("SELECT type, project_id FROM activity_events WHERE type = 'project_added'");
    expect(ev.map((e) => e.project_id).sort()).toEqual([a, b].sort());
  });

  it("rejects invalid input with zod errors and writes nothing", async () => {
    await expect(createProject({ name: "   " })).rejects.toBeInstanceOf(ZodError);
    await expect(createProject({ name: "X", color: "red" })).rejects.toBeInstanceOf(ZodError);
    await expect(createProject({ name: "X", target_launch_on: "2026/01/01" })).rejects.toBeInstanceOf(ZodError);
    expect(await listProjects()).toEqual([]);
    expect(await count("SELECT count(*) AS n FROM audit_log")).toBe(0);
  });

  it("partial updates only touch the provided fields (zod defaults are not re-applied)", async () => {
    const id = await createProject({ name: "Casaca de Cancha", type: "ecommerce", status: "production", priority: "high", languages: ["TypeScript"], frameworks: ["Next.js"], source: "discovery" });
    await updateProject(id, { description: "Camisetas" });
    const p = (await getProject(id))!;
    expect(p).toMatchObject({ description: "Camisetas", type: "ecommerce", status: "production", priority: "high", languages: ["TypeScript"], frameworks: ["Next.js"], source: "discovery" });
    expect(await count("SELECT count(*) AS n FROM activity_events WHERE type = 'status_changed'")).toBe(0);
  });

  it("updates with audit and logs status changes; deletes with audit", async () => {
    const id = await createProject({ name: "MEMO" });
    await updateProject(id, { status: "beta", description: "Recordatorios", frameworks: ["Expo"] });
    const p = (await getProject(id))!;
    expect(p.status).toBe("beta");
    expect(p.frameworks).toEqual(["Expo"]);
    expect(await count("SELECT count(*) AS n FROM activity_events WHERE type = 'status_changed' AND project_id = ?", [id])).toBe(1);
    await expect(updateProject(id, { name: "" })).rejects.toBeInstanceOf(ZodError);
    await expect(updateProject("missing", { name: "x" })).rejects.toThrow(/no encontrado/);
    await deleteProject(id);
    expect(await getProject(id)).toBeNull();
    expect((await auditTrail("project", id)).map((r) => r.action).sort()).toEqual(["create", "delete", "update"]);
  });
});

describe("transactions", () => {
  it("create / update / soft-delete / restore keep an audit trail", async () => {
    const pid = await createProject({ name: "Cerquita" });
    const id = (await createTransaction({ kind: "income", category: "sales", amount_minor: 50_000, currency: "USD", occurred_on: "2026-10-01", project_id: pid, description: "Plan anual" }))!;
    expect(id).toBeTruthy();
    expect(await count("SELECT count(*) AS n FROM activity_events WHERE type = 'sale' AND project_id = ?", [pid])).toBe(1);

    await updateTransaction(id, { amount_minor: 45_000 });
    expect((await getTransaction(id))!.amount_minor).toBe(45_000);

    await deleteTransaction(id);
    expect(await listTransactions()).toEqual([]);
    expect((await listTransactions({ includeDeleted: true })).map((x) => x.id)).toEqual([id]);

    await restoreTransaction(id);
    expect((await listTransactions()).map((x) => x.id)).toEqual([id]);

    const trail = await auditTrail("transaction", id);
    expect(trail.map((r) => r.action).sort()).toEqual(["create", "delete", "restore", "update"]);
    const upd = trail.find((r) => r.action === "update")!;
    expect(JSON.parse(upd.before!).amount_minor).toBe(50_000);
    expect(JSON.parse(upd.after!).amount_minor).toBe(45_000);
  });

  it("partial updates keep category and status", async () => {
    const id = (await createTransaction({ kind: "income", category: "subscriptions", amount_minor: 1_000, currency: "USD", occurred_on: "2026-10-01", status: "pending" }))!;
    await updateTransaction(id, { amount_minor: 1_200 });
    expect(await getTransaction(id)).toMatchObject({ amount_minor: 1_200, category: "subscriptions", status: "pending" });
  });

  it("validates amounts, currencies and dates", async () => {
    await expect(createTransaction({ kind: "income", amount_minor: -1, currency: "USD", occurred_on: "2026-10-01" })).rejects.toBeInstanceOf(ZodError);
    await expect(createTransaction({ kind: "income", amount_minor: 1.5, currency: "USD", occurred_on: "2026-10-01" })).rejects.toBeInstanceOf(ZodError);
    await expect(createTransaction({ kind: "income", amount_minor: 1, currency: "usd", occurred_on: "2026-10-01" })).rejects.toBeInstanceOf(ZodError);
    await expect(createTransaction({ kind: "income", amount_minor: 1, currency: "USD", occurred_on: "01/10/2026" })).rejects.toBeInstanceOf(ZodError);
    await expect(createTransaction({ kind: "gift" as never, amount_minor: 1, currency: "USD", occurred_on: "2026-10-01" })).rejects.toBeInstanceOf(ZodError);
  });

  it("filters by project, kind, currency, status and search", async () => {
    const pid = await createProject({ name: "FitNow" });
    await createTransaction({ kind: "income", amount_minor: 100, currency: "USD", occurred_on: "2026-10-01", project_id: pid, description: "Suscripción" });
    await createTransaction({ kind: "expense", category: "hosting", amount_minor: 200, currency: "ARS", occurred_on: "2026-10-05", status: "pending" });
    expect((await listTransactions({ projectId: pid })).length).toBe(1);
    expect((await listTransactions({ projectId: "none" })).length).toBe(1);
    expect((await listTransactions({ kind: "expense", currency: "ARS", status: "pending" })).length).toBe(1);
    expect((await listTransactions({ from: "2026-10-02" })).length).toBe(1);
    expect((await listTransactions({ search: "suscrip" })).length).toBe(1);
  });

  it("importDrafts is idempotent and undoImport soft-deletes the batch", async () => {
    const csv = "Fecha,Descripción,Monto,Moneda\n01/10/2026,Venta 1,1500,ARS\n02/10/2026,Hosting,-300,ARS\n02/10/2026,Hosting,-300,ARS\n03/10/2026,Venta 2,\"2.000,50\",ARS\n";
    const { headers, rows } = parseCsv(csv);
    const preview = buildDrafts(rows, { mapping: detectMapping(headers), defaultCurrency: "ARS", dateOrder: "dmy", projectId: null, batchId: "batch-1" });
    expect(preview.duplicatesInFile).toBe(1);
    const first = await importDrafts(preview.drafts, "csv", "batch-1");
    expect(first).toEqual({ inserted: 3, duplicates: 0, batchId: "batch-1" });

    const second = await importDrafts(preview.drafts, "csv", "batch-2");
    expect(second).toEqual({ inserted: 0, duplicates: 3, batchId: "batch-2" });
    expect((await listTransactions()).length).toBe(3);
    expect(await count("SELECT count(*) AS n FROM activity_events WHERE type = 'import'")).toBe(1);
    expect((await listImportBatches()).map((b) => [b.import_batch_id, b.n])).toEqual([["batch-1", 3]]);

    expect(await undoImport("batch-1")).toBe(3);
    expect(await listTransactions()).toEqual([]);
    expect((await listTransactions({ includeDeleted: true })).every((x) => x.deleted_at)).toBe(true);
    expect((await auditTrail("import_batch", "batch-1")).map((r) => r.action)).toEqual(["delete"]);
  });

  it("upsertExternalTransactions updates status pending → cleared without duplicating", async () => {
    const t1: ExternalTx = { external_id: "txn_1", project_id: null, kind: "income", category: "sales", description: "Cobro", counterparty: null, amount_minor: 1000, currency: "USD", occurred_on: "2026-10-01", status: "pending" };
    expect(await upsertExternalTransactions("stripe", [t1])).toEqual({ inserted: 1, updated: 0 });
    // user re-categorizes; provider later clears the payment
    const id = (await listTransactions())[0].id;
    await updateTransaction(id, { category: "subscriptions" });
    expect(await upsertExternalTransactions("stripe", [{ ...t1, status: "cleared" }])).toEqual({ inserted: 0, updated: 1 });
    const all = await listTransactions();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: "cleared", category: "subscriptions", source: "stripe", external_id: "txn_1" });
    // same external id from another source is a different transaction
    expect(await upsertExternalTransactions("mercadopago", [t1])).toEqual({ inserted: 1, updated: 0 });
    expect(await upsertExternalTransactions("stripe", [])).toEqual({ inserted: 0, updated: 0 });
  });

  it("markRecurringPaid creates one expense and advances next_due_on; paying the same due date twice does not duplicate", async () => {
    const id = await saveRecurring({ name: "Vercel Pro", vendor: "Vercel", category: "hosting", amount_minor: 2_000, currency: "USD", interval: "monthly", next_due_on: "2026-01-31" });
    await markRecurringPaid(id, "2026-01-31");
    let rc = (await listRecurring()).find((r) => r.id === id)!;
    expect(rc.next_due_on).toBe("2026-02-28");
    expect(rc.active).toBe(true);
    const txs = await listTransactions();
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ kind: "expense", category: "hosting", amount_minor: 2_000, currency: "USD", occurred_on: "2026-01-31", source: "recurring", external_id: `rc:${id}:2026-01-31`, recurring_cost_id: id });

    // a second payment registered for the same due date (e.g. double click / restored state)
    await updateById("recurring_costs", id, { next_due_on: "2026-01-31" });
    await markRecurringPaid(id, "2026-02-01");
    expect(await listTransactions()).toHaveLength(1);
    rc = (await listRecurring()).find((r) => r.id === id)!;
    expect(rc.next_due_on).toBe("2026-02-28");

    // the next period is a new expense
    await markRecurringPaid(id, "2026-02-28");
    expect(await listTransactions()).toHaveLength(2);
    expect((await listRecurring())[0].next_due_on! > "2026-02-28").toBe(true);
    await expect(markRecurringPaid("missing")).rejects.toThrow();
  });

  it("exchange rates keep source/date and upsert on the same key; budgets upsert", async () => {
    await addRate("USD", "ARS", 1400, "2026-11-06", "manual");
    await addRate("USD", "ARS", 1450, "2026-11-06", "manual");
    await addRate("USD", "ARS", 1430, "2026-11-06", "dolarapi.com · blue (venta)");
    const rates = await listRates();
    expect(rates).toHaveLength(2);
    expect(rates.find((r) => r.source === "manual")!.rate).toBe(1450);
    await expect(addRate("USD", "ARS", 0, "2026-11-06", "manual")).rejects.toThrow();
    await expect(addRate("USD", "USD", 1, "2026-11-06", "manual")).rejects.toThrow();

    await saveBudget(null, "2026-11", "USD", 10_000);
    await saveBudget(null, "2026-11", "USD", 12_000);
    const b = await listBudgets("2026-11");
    expect(b).toHaveLength(1);
    expect(b[0].amount_minor).toBe(12_000);
  });
});

describe("tasks", () => {
  it("CRUD; completing a task sets completed_at and logs activity", async () => {
    const pid = await createProject({ name: "PROFE" });
    const id = (await createTask({ title: "Onboarding", project_id: pid, labels: ["ux"], impact: 4, depends_on: [] }))!;
    let task = (await getTask(id))!;
    expect(task).toMatchObject({ title: "Onboarding", status: "todo", priority: "medium", labels: ["ux"], impact: 4, completed_at: null });
    await updateTask(id, { status: "done" });
    task = (await getTask(id))!;
    expect(task.status).toBe("done");
    expect(task.completed_at).toBeTruthy();
    expect(await count("SELECT count(*) AS n FROM activity_events WHERE type = 'task_completed' AND project_id = ?", [pid])).toBe(1);
    await updateTask(id, { status: "todo" });
    expect((await getTask(id))!.completed_at).toBeNull();
    await expect(createTask({ title: "" })).rejects.toBeInstanceOf(ZodError);
    await expect(createTask({ title: "x", impact: 9 })).rejects.toBeInstanceOf(ZodError);
    await deleteTask(id);
    expect(await listTasks()).toEqual([]);
    expect((await auditTrail("task", id)).map((r) => r.action).sort()).toEqual(["create", "delete", "update", "update"]);
  });

  it("partial updates keep priority, labels, dependencies and status", async () => {
    const dep = (await createTask({ title: "Diseño" }))!;
    const id = (await createTask({ title: "Checkout", priority: "urgent", labels: ["pagos"], depends_on: [dep], due_on: "2026-12-01" }))!;
    await updateTask(id, { title: "Checkout v2" });
    expect(await getTask(id)).toMatchObject({ title: "Checkout v2", priority: "urgent", labels: ["pagos"], depends_on: [dep], status: "todo", due_on: "2026-12-01" });
    await updateTask(id, { status: "done" });
    await updateTask(id, { description: "listo" });
    const t2 = (await getTask(id))!;
    expect(t2.status).toBe("done");
    expect(t2.completed_at).toBeTruthy();
  });

  it("deduplicates external tasks by (source, ref)", async () => {
    const a = await createTask({ title: "Issue 1" }, { source: "github", ref: "sovare/memo#1", url: "https://github.com/sovare/memo/issues/1" });
    const b = await createTask({ title: "Issue 1 (again)" }, { source: "github", ref: "sovare/memo#1" });
    expect(a).toBeTruthy();
    expect(b).toBeNull();
    expect(await listTasks()).toHaveLength(1);
    // manual tasks with the same title are not deduplicated
    await createTask({ title: "Issue 1" });
    await createTask({ title: "Issue 1" });
    expect(await listTasks()).toHaveLength(3);
  });
});

describe("repositories", () => {
  it("upsertRepository keeps known values (project_id) when later upserts pass null", async () => {
    const pid = await createProject({ name: "CosovGO" });
    const id = await upsertRepository({ canonical_key: "github.com/sovare/cosovgo", provider: "github", project_id: pid, full_name: "sovare/cosovgo", stars: 3, is_private: true });
    const again = await upsertRepository({ canonical_key: "github.com/sovare/cosovgo", provider: "github", project_id: null, full_name: null, stars: 5, is_private: false });
    expect(again).toBe(id);
    const repos = await listRepositories();
    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({ project_id: pid, full_name: "sovare/cosovgo", stars: 5, is_private: 0 });
  });
});

describe("alerts reconciliation", () => {
  it("opens, keeps and resolves alerts as data changes", async () => {
    const TODAY = "2026-11-07";
    const tid = (await createTask({ title: "Renovar dominio", due_on: "2026-11-01", priority: "high" }))!;
    const opened = await evaluateAlerts(TODAY);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ rule_id: "task_overdue", status: "open", severity: "warning", fingerprint: `task_overdue:${tid}:2026-11-01` });

    // re-evaluating does not duplicate nor re-notify
    expect(await evaluateAlerts(TODAY)).toEqual([]);
    const open = await listAlerts("open");
    expect(open).toHaveLength(1);
    expect(open[0].last_seen_at >= open[0].first_seen_at).toBe(true);

    // condition disappears → resolved
    await updateTask(tid, { status: "done" });
    expect(await evaluateAlerts(TODAY)).toEqual([]);
    expect(await listAlerts("open")).toEqual([]);
    const resolved = await listAlerts("resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0].resolved_at).toBeTruthy();
    expect(await count("SELECT count(*) AS n FROM alerts")).toBe(1);
  });

  it("re-opens an alert whose condition comes back long after it was resolved", async () => {
    const tid = (await createTask({ title: "Pagar AFIP", due_on: "2026-11-01" }))!;
    await evaluateAlerts("2026-11-07");
    await updateTask(tid, { status: "done" });
    await evaluateAlerts("2026-11-07");
    expect(await listAlerts("resolved")).toHaveLength(1);
    // two months pass; the task is reopened and is still overdue
    await db().execute("UPDATE alerts SET resolved_at = '2026-09-01T00:00:00.000Z'");
    await updateTask(tid, { status: "todo" });
    const reopened = await evaluateAlerts("2026-11-07");
    expect(reopened).toHaveLength(1);
    expect(reopened[0]).toMatchObject({ status: "open", resolved_at: null, rule_id: "task_overdue" });
    expect(await listAlerts("open")).toHaveLength(1);
    expect(await count("SELECT count(*) AS n FROM alerts")).toBe(1);
  });

  it("an ongoing outage keeps a single open health alert across checks", async () => {
    await db().execute("INSERT INTO health_checks (id, name, url, created_at, updated_at) VALUES ('hc', 'API', 'https://api.example.com/health', 'n', 'n')");
    const result = (i: number, ok: boolean) => db().execute("INSERT INTO health_results (id, check_id, checked_at, ok, status_code) VALUES (?, 'hc', ?, ?, ?)", [`r${i}`, `2026-11-07T10:${String(i * 15).padStart(2, "0")}:00.000Z`, ok ? 1 : 0, ok ? 200 : 503]);
    await result(0, true);
    await result(1, false);
    await result(2, false);
    const first = await evaluateAlerts("2026-11-07");
    expect(first.map((a) => a.rule_id)).toEqual(["health_down"]);
    await result(3, false); // still down
    expect(await evaluateAlerts("2026-11-07")).toEqual([]);
    const open = await listAlerts("open");
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(first[0].id);
    expect(await listAlerts("resolved")).toEqual([]);
  });

  it("dismissed alerts stay dismissed while the condition persists", async () => {
    await createTask({ title: "Vieja", due_on: "2026-10-01" });
    const [a] = await evaluateAlerts("2026-11-07");
    await setAlertStatus(a.id, "dismissed");
    expect(await evaluateAlerts("2026-11-07")).toEqual([]);
    expect((await listAlerts("all")).map((x) => x.status)).toEqual(["dismissed"]);
  });

  it("disabled rules (alert_rules) are respected", async () => {
    await db().execute("INSERT INTO alert_rules (id, enabled, notify, params, updated_at) VALUES ('task_overdue', 0, 1, '{}', 'n')");
    await createTask({ title: "Vieja", due_on: "2026-10-01" });
    expect(await evaluateAlerts("2026-11-07")).toEqual([]);
  });
});

describe("globalSearch", () => {
  it("finds projects, tasks and transactions", async () => {
    const pid = await createProject({ name: "GastroOS", description: "Gestión de restaurantes" });
    await createTask({ title: "Lanzar beta de GastroOS", project_id: pid });
    await createTransaction({ kind: "income", amount_minor: 100, currency: "USD", occurred_on: "2026-10-01", description: "Licencia gastroos" });
    await createTransaction({ kind: "income", amount_minor: 100, currency: "USD", occurred_on: "2026-10-01", description: "Otra cosa" });
    const hits = await globalSearch("gastro");
    const types = new Set(hits.map((h) => h.type));
    expect(types).toEqual(new Set(["project", "task", "transaction", "event"]));
    expect(hits.find((h) => h.type === "project")).toMatchObject({ id: pid, title: "GastroOS", route: `/projects/${pid}` });
    expect(hits.filter((h) => h.type === "transaction")).toHaveLength(1);
    expect(await globalSearch("g")).toEqual([]);
    expect(await globalSearch("restaurantes")).toEqual([expect.objectContaining({ type: "project", id: pid })]);
  });

  it("excludes soft-deleted transactions", async () => {
    const id = (await createTransaction({ kind: "expense", amount_minor: 100, currency: "USD", occurred_on: "2026-10-01", description: "Figma anual" }))!;
    await deleteTransaction(id);
    expect((await globalSearch("figma")).filter((h) => h.type === "transaction")).toEqual([]);
  });
});

describe("preferences", () => {
  it("round-trips JSON values with fallbacks", async () => {
    expect(await getPref("x", 1)).toBe(1);
    await setPref("x", { a: [1, 2] });
    await setPref("x", { a: [3] });
    expect(await getPref("x", null)).toEqual({ a: [3] });
  });
});

describe("persistence", () => {
  it("data survives exporting and reopening the database file", async () => {
    const pid = await createProject({ name: "Trading Bot", status: "development" });
    await createTransaction({ kind: "expense", category: "ai", amount_minor: 1234, currency: "USD", occurred_on: "2026-10-01", project_id: pid });
    await createTask({ title: "Backtest", project_id: pid });
    await setPref("theme", "dark");

    const bytes = t.raw.export();
    t.raw.close();
    const r = await reopen(t.SQL, bytes);
    expect(await migrate(r.db)).toMatchObject({ applied: [] });
    expect((await listProjects()).map((p) => p.name)).toEqual(["Trading Bot"]);
    expect((await listTransactions())[0]).toMatchObject({ amount_minor: 1234, currency: "USD", project_id: pid });
    expect((await listTasks())[0].title).toBe("Backtest");
    expect(await getPref("theme", "light")).toBe("dark");
    expect(await count("SELECT count(*) AS n FROM audit_log")).toBeGreaterThanOrEqual(3);
    r.raw.close();
  });
});

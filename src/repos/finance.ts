import { db } from "@/db";
import type { Budget, ExchangeRate, RecurringCost, Transaction, TxKind } from "@/domain/types";
import { nextDueDate } from "@/domain/finance";
import type { DraftTx } from "@/domain/csvImport";
import { formatMoney } from "@/domain/money";
import { nowIso, todayStr, uid } from "@/lib/util";
import { audit, insert, logActivity, mapRow, onlyProvided, updateById } from "./core";
import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
export const txInput = z.object({
  project_id: z.string().nullish(),
  kind: z.enum(["income", "expense", "refund", "fee", "investment"]),
  category: z.string().min(1).default("other"),
  description: z.string().max(500).nullish(),
  counterparty: z.string().max(200).nullish(),
  amount_minor: z.number().int().nonnegative("El importe debe ser positivo").max(1e15),
  currency: z.string().regex(/^[A-Z]{3}$/),
  occurred_on: date,
  status: z.enum(["cleared", "pending"]).default("cleared"),
  attachment: z.string().nullish(),
  notes: z.string().max(5000).nullish(),
});
export type TxInput = z.input<typeof txInput>;

export interface TxFilter {
  from?: string;
  to?: string;
  projectId?: string | "none";
  kind?: TxKind;
  currency?: string;
  status?: "cleared" | "pending";
  search?: string;
  includeDeleted?: boolean;
}

export async function listTransactions(f: TxFilter = {}): Promise<Transaction[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (!f.includeDeleted) where.push("deleted_at IS NULL");
  if (f.from) { where.push("occurred_on >= ?"); params.push(f.from); }
  if (f.to) { where.push("occurred_on <= ?"); params.push(f.to); }
  if (f.projectId === "none") where.push("project_id IS NULL");
  else if (f.projectId) { where.push("project_id = ?"); params.push(f.projectId); }
  if (f.kind) { where.push("kind = ?"); params.push(f.kind); }
  if (f.currency) { where.push("currency = ?"); params.push(f.currency); }
  if (f.status) { where.push("status = ?"); params.push(f.status); }
  if (f.search) {
    where.push("(description LIKE ? OR counterparty LIKE ? OR category LIKE ? OR notes LIKE ?)");
    const s = `%${f.search}%`;
    params.push(s, s, s, s);
  }
  return db().select<Transaction>(
    `SELECT * FROM financial_transactions ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY occurred_on DESC, created_at DESC`,
    params,
  );
}

export async function getTransaction(id: string) {
  return (await db().select<Transaction>("SELECT * FROM financial_transactions WHERE id = ?", [id]))[0] ?? null;
}

const KIND_ACTIVITY: Record<TxKind, string> = { income: "Nuevo ingreso", expense: "Nuevo gasto", refund: "Reembolso", fee: "Comisión", investment: "Inversión registrada" };

export async function createTransaction(input: TxInput, source = "manual", opts: { external_id?: string; recurring_cost_id?: string } = {}) {
  const t = txInput.parse(input);
  const id = uid();
  const now = nowIso();
  const row = {
    id,
    ...t,
    project_id: t.project_id ?? null,
    description: t.description ?? null,
    counterparty: t.counterparty ?? null,
    attachment: t.attachment ?? null,
    notes: t.notes ?? null,
    source,
    external_id: opts.external_id ?? null,
    recurring_cost_id: opts.recurring_cost_id ?? null,
    created_at: now,
    updated_at: now,
  };
  const r = await insert("financial_transactions", row, opts.external_id ? "OR IGNORE" : "");
  if (!r.changes) return null;
  await audit("transaction", id, "create", null, row);
  await logActivity({
    source: source === "manual" ? "sovare" : source,
    type: t.kind === "income" ? "sale" : t.kind,
    title: `${KIND_ACTIVITY[t.kind]}: ${formatMoney(t.amount_minor, t.currency)}${t.description ? " · " + t.description : ""}`,
    project_id: t.project_id ?? null,
    occurred_at: `${t.occurred_on}T12:00:00.000Z`,
    external_id: `tx:${id}`,
  });
  return id;
}

/** Auditable correction: the previous version is kept in audit_log. */
export async function updateTransaction(id: string, patch: Partial<TxInput>) {
  const before = await getTransaction(id);
  if (!before) throw new Error("Transacción no encontrada");
  const p = onlyProvided(txInput.partial().parse(patch), patch);
  await updateById("financial_transactions", id, { ...p, updated_at: nowIso() } as Record<string, string | number | null>);
  await audit("transaction", id, "update", before, p);
}

export async function deleteTransaction(id: string) {
  const before = await getTransaction(id);
  await updateById("financial_transactions", id, { deleted_at: nowIso(), updated_at: nowIso() });
  await audit("transaction", id, "delete", before, null);
}

export async function restoreTransaction(id: string) {
  await updateById("financial_transactions", id, { deleted_at: null, updated_at: nowIso() });
  await audit("transaction", id, "restore", null, null);
}

export interface ImportResult {
  inserted: number;
  duplicates: number;
  batchId: string;
}

/** Inserts drafts idempotently: (source, external_id) is unique, so re-imports are skipped. */
export async function importDrafts(drafts: DraftTx[], source: string, batchId: string): Promise<ImportResult> {
  const now = nowIso();
  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < drafts.length; i += CHUNK) {
    const chunk = drafts.slice(i, i + CHUNK);
    const before = await db().select<{ n: number }>("SELECT count(*) AS n FROM financial_transactions WHERE source = ?", [source]);
    await db().batch(
      chunk.map((d) => ({
        sql: `INSERT OR IGNORE INTO financial_transactions (id, project_id, kind, category, description, counterparty, amount_minor, currency, occurred_on, status, source, external_id, import_batch_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [uid(), d.project_id, d.kind, d.category, d.description, d.counterparty, d.amount_minor, d.currency, d.occurred_on, d.status, source, d.external_id, batchId, now, now],
      })),
    );
    const after = await db().select<{ n: number }>("SELECT count(*) AS n FROM financial_transactions WHERE source = ?", [source]);
    inserted += after[0].n - before[0].n;
  }
  if (inserted)
    await logActivity({ source, type: "import", title: `Importación: ${inserted} transacciones nuevas`, external_id: `import:${batchId}` });
  return { inserted, duplicates: drafts.length - inserted, batchId };
}

export async function undoImport(batchId: string) {
  const r = await db().execute("UPDATE financial_transactions SET deleted_at = ?, updated_at = ? WHERE import_batch_id = ? AND deleted_at IS NULL", [nowIso(), nowIso(), batchId]);
  await audit("import_batch", batchId, "delete", null, { rows: r.changes });
  return r.changes;
}

export async function listImportBatches() {
  return db().select<{ import_batch_id: string; source: string; n: number; first: string; created_at: string }>(
    `SELECT import_batch_id, source, count(*) AS n, min(occurred_on) AS first, min(created_at) AS created_at
     FROM financial_transactions WHERE import_batch_id IS NOT NULL AND deleted_at IS NULL GROUP BY import_batch_id, source ORDER BY created_at DESC LIMIT 20`,
  );
}

// ---------- recurring costs / subscriptions ----------
export const recurringInput = z.object({
  project_id: z.string().nullish(),
  name: z.string().trim().min(1).max(120),
  vendor: z.string().max(120).nullish(),
  category: z.string().default("tools"),
  amount_minor: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  interval: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  next_due_on: date.nullish().or(z.literal("")),
  active: z.boolean().default(true),
  url: z.string().url().nullish().or(z.literal("")),
  notes: z.string().max(2000).nullish(),
});
export type RecurringInput = z.input<typeof recurringInput>;

export async function listRecurring(): Promise<RecurringCost[]> {
  const rows = await db().select("SELECT * FROM recurring_costs ORDER BY active DESC, next_due_on IS NULL, next_due_on");
  return rows.map((r) => mapRow<RecurringCost>(r, { bool: ["active"] }));
}

export async function saveRecurring(input: RecurringInput, id?: string) {
  const r = recurringInput.parse(input);
  const row = { ...r, next_due_on: r.next_due_on || null, url: r.url || null, project_id: r.project_id ?? null, vendor: r.vendor ?? null, notes: r.notes ?? null, updated_at: nowIso() };
  if (id) {
    await updateById("recurring_costs", id, row);
    await audit("recurring_cost", id, "update", null, row);
    return id;
  }
  const newId = uid();
  await insert("recurring_costs", { id: newId, ...row, created_at: nowIso() });
  await audit("recurring_cost", newId, "create", null, row);
  return newId;
}

export async function deleteRecurring(id: string) {
  await db().execute("DELETE FROM recurring_costs WHERE id = ?", [id]);
  await audit("recurring_cost", id, "delete", null, null);
}

/** Records the payment of a recurring cost as an expense and advances its next due date. */
export async function markRecurringPaid(id: string, paidOn = todayStr()) {
  const rc = (await listRecurring()).find((r) => r.id === id);
  if (!rc) throw new Error("Costo recurrente no encontrado");
  const due = rc.next_due_on ?? paidOn;
  await createTransaction(
    { kind: "expense", category: rc.category, description: `${rc.name}${rc.vendor ? " · " + rc.vendor : ""}`, amount_minor: rc.amount_minor, currency: rc.currency, occurred_on: paidOn, project_id: rc.project_id, status: "cleared" },
    "recurring",
    { external_id: `rc:${id}:${due}`, recurring_cost_id: id },
  );
  await updateById("recurring_costs", id, { next_due_on: nextDueDate(due, rc.interval), updated_at: nowIso() });
  await logActivity({ source: "sovare", type: "subscription_renewed", title: `Renovación pagada: ${rc.name}`, project_id: rc.project_id, external_id: `rc_paid:${id}:${due}` });
}

// ---------- exchange rates ----------
export async function listRates(): Promise<ExchangeRate[]> {
  return db().select<ExchangeRate>("SELECT * FROM exchange_rates ORDER BY as_of DESC, created_at DESC");
}

export async function addRate(base: string, quote: string, rate: number, asOf: string, source: string) {
  if (!(rate > 0) || !isFinite(rate)) throw new Error("El tipo de cambio debe ser un número positivo");
  if (base === quote) throw new Error("Las monedas deben ser distintas");
  await db().execute(
    `INSERT INTO exchange_rates (id, base, quote, rate, as_of, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(base, quote, as_of, source) DO UPDATE SET rate = excluded.rate`,
    [uid(), base, quote, rate, date.parse(asOf), source.trim() || "manual", nowIso()],
  );
}

export async function deleteRate(id: string) {
  await db().execute("DELETE FROM exchange_rates WHERE id = ?", [id]);
}

// ---------- budgets ----------
export async function listBudgets(month?: string): Promise<Budget[]> {
  return month
    ? db().select<Budget>("SELECT * FROM budgets WHERE month = ? ORDER BY project_id IS NOT NULL, project_id", [month])
    : db().select<Budget>("SELECT * FROM budgets ORDER BY month DESC");
}

export async function saveBudget(projectId: string | null, month: string, currency: string, amountMinor: number) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Mes inválido");
  const existing = await db().select<{ id: string }>("SELECT id FROM budgets WHERE COALESCE(project_id,'') = ? AND month = ? AND currency = ?", [projectId ?? "", month, currency]);
  if (existing[0]) await updateById("budgets", existing[0].id, { amount_minor: amountMinor, updated_at: nowIso() });
  else await insert("budgets", { id: uid(), project_id: projectId, month, currency, amount_minor: amountMinor, created_at: nowIso(), updated_at: nowIso() });
}

export async function deleteBudget(id: string) {
  await db().execute("DELETE FROM budgets WHERE id = ?", [id]);
}

export interface ExternalTx {
  external_id: string;
  project_id: string | null;
  kind: TxKind;
  category: string;
  description: string | null;
  counterparty: string | null;
  amount_minor: number;
  currency: string;
  occurred_on: string;
  status: "cleared" | "pending";
}

/**
 * Idempotent upsert of provider transactions keyed by (source, external_id). Status/amount updates
 * from the provider (e.g. pending → available) overwrite the stored row; user-edited fields like
 * project and category are preserved.
 */
export async function upsertExternalTransactions(source: string, list: ExternalTx[]): Promise<{ inserted: number; updated: number }> {
  if (!list.length) return { inserted: 0, updated: 0 };
  const ids = list.map((t) => t.external_id);
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const rows = await db().select<{ external_id: string }>(`SELECT external_id FROM financial_transactions WHERE source = ? AND external_id IN (${chunk.map(() => "?").join(",")})`, [source, ...chunk]);
    rows.forEach((r) => existing.add(r.external_id));
  }
  const now = nowIso();
  await db().batch(
    list.map((t) => ({
      sql: `INSERT INTO financial_transactions (id, project_id, kind, category, description, counterparty, amount_minor, currency, occurred_on, status, source, external_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET status = excluded.status, amount_minor = excluded.amount_minor, updated_at = excluded.updated_at`,
      params: [uid(), t.project_id, t.kind, t.category, t.description, t.counterparty, t.amount_minor, t.currency, t.occurred_on, t.status, source, t.external_id, now, now],
    })),
  );
  const fresh = list.filter((t) => !existing.has(t.external_id));
  for (const t of fresh.filter((x) => x.kind === "income").slice(0, 50))
    await logActivity({ source, type: "sale", title: `Nueva venta: ${formatMoney(t.amount_minor, t.currency)}${t.description ? " · " + t.description : ""}`, project_id: t.project_id, occurred_at: `${t.occurred_on}T12:00:00.000Z`, external_id: `${source}:${t.external_id}` });
  return { inserted: fresh.length, updated: list.length - fresh.length };
}

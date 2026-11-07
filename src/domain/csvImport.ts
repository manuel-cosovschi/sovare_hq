/**
 * CSV import for transactions: header auto-detection (ES/EN), amount/date normalization and
 * deterministic fingerprints so re-importing the same file never creates duplicates.
 */
import Papa from "papaparse";
import { fnv1a } from "@/lib/util";
import { parseAmount, toMinor, type Currency } from "./money";
import type { TxKind } from "./types";

export type FieldKey = "date" | "amount" | "currency" | "description" | "kind" | "category" | "project" | "external_id" | "status" | "counterparty" | "credit" | "debit";

export const FIELD_LABEL: Record<FieldKey, string> = {
  date: "Fecha", amount: "Importe", currency: "Moneda", description: "Descripción", kind: "Tipo", category: "Categoría",
  project: "Proyecto", external_id: "ID externo", status: "Estado", counterparty: "Contraparte", credit: "Crédito / Ingreso", debit: "Débito / Egreso",
};

const SYNONYMS: Record<FieldKey, string[]> = {
  date: ["date", "fecha", "fecha de operacion", "fecha operacion", "release_date", "date_created", "created", "fecha de creacion", "dia"],
  amount: ["amount", "importe", "monto", "total", "valor", "transaction_net_amount", "net", "neto", "transaction_amount"],
  currency: ["currency", "moneda", "currency_id", "divisa"],
  description: ["description", "descripcion", "detalle", "concepto", "concept", "memo", "transaction_type", "reason"],
  kind: ["kind", "tipo", "type", "movimiento"],
  category: ["category", "categoria", "rubro"],
  project: ["project", "proyecto", "negocio"],
  external_id: ["id", "external_id", "reference_id", "operation_id", "id de operacion", "referencia", "transaction_id", "source_id"],
  status: ["status", "estado"],
  counterparty: ["counterparty", "contraparte", "cliente", "proveedor", "customer", "vendor", "payer"],
  credit: ["credit", "credito", "ingreso", "haber"],
  debit: ["debit", "debito", "egreso", "debe"],
};

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[\s_]+/g, " ");

export type Mapping = Partial<Record<FieldKey, string>>;

export function detectMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<string>();
  for (const field of Object.keys(SYNONYMS) as FieldKey[]) {
    const syn = SYNONYMS[field].map(norm);
    const hit = headers.find((h) => !used.has(h) && syn.includes(norm(h)));
    if (hit) {
      mapping[field] = hit;
      used.add(hit);
    }
  }
  return mapping;
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  errors: string[];
}

export function parseCsv(text: string): ParsedCsv {
  const res = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return {
    headers: res.meta.fields ?? [],
    rows: res.data,
    errors: res.errors.slice(0, 20).map((e) => `Fila ${(e.row ?? 0) + 2}: ${e.message}`),
  };
}

export type DateOrder = "dmy" | "mdy" | "ymd";

export function parseDate(input: string, order: DateOrder = "dmy"): string | null {
  const s = input.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return fmt(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let a = +m[1];
    let b = +m[2];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (order === "mdy") [a, b] = [b, a];
    // auto-correct impossible combinations (e.g. 13/02 in mdy)
    if (b > 12 && a <= 12) [a, b] = [b, a];
    return fmt(y, b, a);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return fmt(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return null;
}

function fmt(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const KIND_WORDS: Array<[TxKind, string[]]> = [
  ["refund", ["refund", "reembolso", "devolucion", "contracargo", "chargeback"]],
  ["fee", ["fee", "comision", "commission", "cargo por servicio", "processing"]],
  ["investment", ["investment", "inversion", "capex"]],
  ["income", ["income", "ingreso", "venta", "sale", "payment", "pago recibido", "cobro", "credit", "credito"]],
  ["expense", ["expense", "gasto", "egreso", "compra", "purchase", "debit", "debito", "pago"]],
];

export function inferKind(raw: string | undefined, signedAmount: number): TxKind {
  if (raw) {
    const n = norm(raw);
    for (const [kind, words] of KIND_WORDS) if (words.some((w) => n.includes(w))) return kind;
  }
  return signedAmount < 0 ? "expense" : "income";
}

export interface ImportOptions {
  mapping: Mapping;
  defaultCurrency: Currency;
  dateOrder: DateOrder;
  projectId: string | null;
  projectLookup?: (name: string) => string | null;
  batchId: string;
}

export interface DraftTx {
  row: number;
  kind: TxKind;
  category: string;
  description: string | null;
  counterparty: string | null;
  amount_minor: number;
  currency: Currency;
  occurred_on: string;
  status: "cleared" | "pending";
  external_id: string;
  project_id: string | null;
}

export interface ImportPreview {
  drafts: DraftTx[];
  invalid: Array<{ row: number; reason: string }>;
  duplicatesInFile: number;
}

export function buildDrafts(rows: Record<string, string>[], opts: ImportOptions): ImportPreview {
  const { mapping } = opts;
  const get = (r: Record<string, string>, f: FieldKey) => (mapping[f] ? (r[mapping[f]!] ?? "").trim() : "");
  const drafts: DraftTx[] = [];
  const invalid: ImportPreview["invalid"] = [];
  const seen = new Set<string>();
  let duplicatesInFile = 0;
  rows.forEach((r, i) => {
    const rowNo = i + 2; // header is row 1
    const date = parseDate(get(r, "date"), opts.dateOrder);
    if (!date) return void invalid.push({ row: rowNo, reason: "Fecha inválida o vacía" });
    let signed: number;
    if (mapping.amount) signed = parseAmount(get(r, "amount"));
    else {
      const credit = parseAmount(get(r, "credit") || "0");
      const debit = parseAmount(get(r, "debit") || "0");
      signed = (isNaN(credit) ? 0 : credit) - (isNaN(debit) ? 0 : Math.abs(debit));
    }
    if (isNaN(signed)) return void invalid.push({ row: rowNo, reason: "Importe inválido" });
    if (signed === 0) return void invalid.push({ row: rowNo, reason: "Importe cero" });
    const currencyRaw = get(r, "currency").toUpperCase();
    const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : opts.defaultCurrency;
    const kind = inferKind(get(r, "kind") || undefined, signed);
    const description = get(r, "description") || null;
    const amount_minor = toMinor(Math.abs(signed), currency);
    const ext = get(r, "external_id");
    const external_id = ext ? `id:${ext}` : `fp:${fnv1a([date, kind, amount_minor, currency, (description ?? "").toLowerCase()].join("|"))}`;
    if (seen.has(external_id)) {
      duplicatesInFile++;
      return;
    }
    seen.add(external_id);
    const projectName = get(r, "project");
    const status = /pend/i.test(get(r, "status")) ? "pending" : "cleared";
    drafts.push({
      row: rowNo,
      kind,
      category: get(r, "category").toLowerCase() || (kind === "income" ? "sales" : kind === "fee" ? "payment_processing" : "other"),
      description,
      counterparty: get(r, "counterparty") || null,
      amount_minor,
      currency,
      occurred_on: date,
      status,
      external_id,
      project_id: (projectName && opts.projectLookup?.(projectName)) || opts.projectId,
    });
  });
  return { drafts, invalid, duplicatesInFile };
}

export function toCsv(rows: Array<Record<string, string | number | null>>): string {
  return Papa.unparse(rows, { quotes: false });
}

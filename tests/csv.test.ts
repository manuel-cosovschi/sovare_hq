import { describe, expect, it } from "vitest";
import { buildDrafts, detectMapping, inferKind, parseCsv, parseDate, type ImportOptions } from "@/domain/csvImport";

describe("detectMapping", () => {
  it("detects Spanish headers (with accents)", () => {
    expect(detectMapping(["Fecha", "Descripción", "Monto", "Moneda", "Tipo", "Categoría", "Proyecto", "Estado", "Cliente"])).toEqual({
      date: "Fecha",
      description: "Descripción",
      amount: "Monto",
      currency: "Moneda",
      kind: "Tipo",
      category: "Categoría",
      project: "Proyecto",
      status: "Estado",
      counterparty: "Cliente",
    });
  });

  it("detects English headers and ids", () => {
    const m = detectMapping(["Date", "Description", "Amount", "Currency", "Type", "Transaction ID", "Status"]);
    expect(m).toMatchObject({ date: "Date", description: "Description", amount: "Amount", currency: "Currency", kind: "Type", external_id: "Transaction ID", status: "Status" });
  });

  it("detects credit/debit columns and leaves unknown headers unmapped", () => {
    const m = detectMapping(["Fecha", "Concepto", "Crédito", "Débito", "Saldo"]);
    expect(m).toEqual({ date: "Fecha", description: "Concepto", credit: "Crédito", debit: "Débito" });
  });
});

describe("parseDate", () => {
  it("parses dmy / mdy / ymd", () => {
    expect(parseDate("07/11/2026", "dmy")).toBe("2026-11-07");
    expect(parseDate("07/11/2026", "mdy")).toBe("2026-07-11");
    expect(parseDate("2026-11-07", "dmy")).toBe("2026-11-07");
    expect(parseDate("2026-11-07T10:20:00Z", "mdy")).toBe("2026-11-07");
    expect(parseDate("7.11.26", "dmy")).toBe("2026-11-07");
    expect(parseDate("07-11-2026", "ymd")).toBe("2026-11-07");
  });

  it("auto-corrects impossible day/month order", () => {
    expect(parseDate("13/02/2026", "mdy")).toBe("2026-02-13");
    expect(parseDate("02/13/2026", "dmy")).toBe("2026-02-13");
  });

  it("rejects invalid dates", () => {
    expect(parseDate("", "dmy")).toBeNull();
    expect(parseDate("31/02/2026", "dmy")).toBeNull();
    expect(parseDate("2026-13-01", "dmy")).toBeNull();
    expect(parseDate("not a date", "dmy")).toBeNull();
    expect(parseDate("01/01/1890", "dmy")).toBeNull();
  });
});

describe("inferKind", () => {
  it("uses words before the sign", () => {
    expect(inferKind("Comisión MP", 100)).toBe("fee");
    expect(inferKind("Devolución", 100)).toBe("refund");
    expect(inferKind("Venta online", -100)).toBe("income");
    expect(inferKind("Gasto", 100)).toBe("expense");
    expect(inferKind("Inversión inicial", -1)).toBe("investment");
    expect(inferKind(undefined, -5)).toBe("expense");
    expect(inferKind(undefined, 5)).toBe("income");
  });
});

const base: ImportOptions = { mapping: {}, defaultCurrency: "ARS", dateOrder: "dmy", projectId: "p1", batchId: "b1" };

describe("buildDrafts", () => {
  it("negative amounts become expenses, amounts are stored positive in minor units", () => {
    const { headers, rows } = parseCsv("Fecha,Descripción,Monto,Moneda\n01/10/2026,Hosting,\"-1.234,50\",ARS\n02/10/2026,Venta,\"15.000,00\",\n");
    const res = buildDrafts(rows, { ...base, mapping: detectMapping(headers) });
    expect(res.invalid).toEqual([]);
    expect(res.drafts).toHaveLength(2);
    expect(res.drafts[0]).toMatchObject({ row: 2, kind: "expense", category: "other", amount_minor: 123_450, currency: "ARS", occurred_on: "2026-10-01", status: "cleared", project_id: "p1" });
    expect(res.drafts[1]).toMatchObject({ row: 3, kind: "income", category: "sales", amount_minor: 1_500_000, currency: "ARS" });
  });

  it("supports credit/debit columns", () => {
    const rows = [
      { Fecha: "01/10/2026", Concepto: "Cobro cliente", Credito: "1.000,00", Debito: "" },
      { Fecha: "02/10/2026", Concepto: "Proveedor", Credito: "", Debito: "250,00" },
    ];
    const res = buildDrafts(rows, { ...base, mapping: { date: "Fecha", description: "Concepto", credit: "Credito", debit: "Debito" } });
    expect(res.drafts.map((d) => [d.kind, d.amount_minor])).toEqual([
      ["income", 100_000],
      ["expense", 25_000],
    ]);
  });

  it("infers kind from the kind column and keeps explicit currency/status/category", () => {
    const rows = [
      { date: "2026-10-01", amount: "10", type: "Comisión", currency: "usd", status: "Pendiente", category: "" },
      { date: "2026-10-01", amount: "20", type: "Reembolso", currency: "USD", status: "", category: "Sales" },
    ];
    const res = buildDrafts(rows, { ...base, mapping: { date: "date", amount: "amount", kind: "type", currency: "currency", status: "status", category: "category" } });
    expect(res.drafts[0]).toMatchObject({ kind: "fee", category: "payment_processing", currency: "USD", status: "pending", amount_minor: 1_000 });
    expect(res.drafts[1]).toMatchObject({ kind: "refund", category: "sales", status: "cleared" });
  });

  it("produces deterministic fingerprints and uses external ids when present", () => {
    const rows = [{ date: "2026-10-01", amount: "-5", desc: "Dominio" }];
    const opts = { ...base, mapping: { date: "date", amount: "amount", description: "desc" } };
    const a = buildDrafts(rows, opts).drafts[0].external_id;
    const b = buildDrafts(rows, { ...opts, batchId: "other" }).drafts[0].external_id;
    expect(a).toMatch(/^fp:[0-9a-f]{8}$/);
    expect(a).toBe(b);
    const c = buildDrafts([{ date: "2026-10-01", amount: "-5", desc: "Dominio 2" }], opts).drafts[0].external_id;
    expect(c).not.toBe(a);
    const withId = buildDrafts([{ date: "2026-10-01", amount: "-5", id: "op-77" }], { ...base, mapping: { date: "date", amount: "amount", external_id: "id" } });
    expect(withId.drafts[0].external_id).toBe("id:op-77");
  });

  it("counts and skips duplicates inside one file", () => {
    const rows = [
      { date: "2026-10-01", amount: "-5", desc: "Dominio" },
      { date: "2026-10-01", amount: "-5", desc: "DOMINIO" },
      { date: "2026-10-02", amount: "-5", desc: "Dominio" },
    ];
    const res = buildDrafts(rows, { ...base, mapping: { date: "date", amount: "amount", description: "desc" } });
    expect(res.drafts).toHaveLength(2);
    expect(res.duplicatesInFile).toBe(1);
  });

  it("reports invalid rows with their file row numbers", () => {
    const rows = [
      { date: "2026-10-01", amount: "10" },
      { date: "fecha?", amount: "10" },
      { date: "2026-10-01", amount: "abc" },
      { date: "2026-10-01", amount: "0" },
    ];
    const res = buildDrafts(rows, { ...base, mapping: { date: "date", amount: "amount" } });
    expect(res.drafts).toHaveLength(1);
    expect(res.invalid).toEqual([
      { row: 3, reason: "Fecha inválida o vacía" },
      { row: 4, reason: "Importe inválido" },
      { row: 5, reason: "Importe cero" },
    ]);
  });

  it("resolves project names through the lookup, falling back to the default", () => {
    const rows = [
      { date: "2026-10-01", amount: "1", proj: "GastroOS" },
      { date: "2026-10-02", amount: "1", proj: "Desconocido" },
    ];
    const res = buildDrafts(rows, { ...base, mapping: { date: "date", amount: "amount", project: "proj" }, projectLookup: (n) => (n === "GastroOS" ? "gastro" : null) });
    expect(res.drafts.map((d) => d.project_id)).toEqual(["gastro", "p1"]);
  });
});

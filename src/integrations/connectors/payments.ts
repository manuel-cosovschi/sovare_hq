import type { ConnectorDef } from "../types";
import { secureJson } from "@/platform/http";
import { withRetry } from "../retry";
import { upsertExternalTransactions, type ExternalTx } from "@/repos/finance";
import { upsertObservations } from "@/repos/metrics";
import { toDateStr, todayStr } from "@/lib/util";
import { toMinor } from "@/domain/money";

const projectField = { key: "project_id", label: "Proyecto al que se asignan los cobros", type: "project" as const, help: "Las transacciones nuevas se asocian a este proyecto (editable luego)." };
const unixDate = (s: number) => toDateStr(new Date(s * 1000));

// ---------------------------------------------------------------- Stripe
interface StripeBT {
  id: string;
  amount: number;
  fee: number;
  currency: string;
  created: number;
  status: "available" | "pending";
  type: string;
  description: string | null;
  reporting_category: string;
}

export const stripeConnector: ConnectorDef = {
  id: "stripe",
  name: "Stripe",
  category: "finance",
  description: "Cobros, comisiones, reembolsos (balance transactions) y MRR de suscripciones activas.",
  availability: "available",
  auth: "token",
  secretKey: "stripe",
  secretLabel: "Restricted API key (solo lectura)",
  permissions: ["Balance: Read", "Balance transactions: Read", "Subscriptions: Read", "Charges: Read"],
  setup: [
    "Stripe Dashboard → Developers → API keys → Create restricted key.",
    "Asigná permisos Read a Balance, Charges y Subscriptions (nada en Write).",
    "Pegá la clave (rk_live_… o rk_test_…). Se guarda en el Llavero.",
    "Elegí el proyecto al que corresponden los cobros.",
  ],
  docsUrl: "https://docs.stripe.com/keys#limit-access",
  limitations: [
    "Payouts y transferencias no son ingresos y no se importan.",
    "El MRR se calcula a partir de suscripciones activas (precio × cantidad, normalizado a mes); descuentos y cupones no se descuentan.",
    "Importes en la moneda original de cada transacción.",
  ],
  incremental: true,
  syncEveryMinutes: 120,
  configFields: [projectField],
  test: async () => {
    const { data } = await withRetry(() => secureJson<{ livemode: boolean; available: Array<{ currency: string }> }>("stripe", { url: "https://api.stripe.com/v1/balance" }));
    return { ok: true, message: `Conectado (${data.livemode ? "live" : "test mode"})`, accountLabel: data.livemode ? "Stripe live" : "Stripe test" };
  },
  sync: async (ctx) => {
    const project = ctx.config.project_id || null;
    const since = ctx.cursor ? Number(ctx.cursor) - 7 * 86400 : Math.floor(Date.now() / 1000) - 365 * 86400;
    const txs: ExternalTx[] = [];
    let after: string | null = null;
    let fetched = 0;
    let maxCreated = since;
    for (let page = 0; page < 20; page++) {
      const url: string = `https://api.stripe.com/v1/balance_transactions?limit=100&created[gte]=${since}${after ? `&starting_after=${after}` : ""}`;
      const { data }: { data: { data: StripeBT[]; has_more: boolean } } = await withRetry(() => secureJson<{ data: StripeBT[]; has_more: boolean }>("stripe", { url }));
      fetched += data.data.length;
      for (const bt of data.data) {
        maxCreated = Math.max(maxCreated, bt.created);
        const cur = bt.currency.toUpperCase();
        const base = { project_id: project, currency: cur, occurred_on: unixDate(bt.created), status: bt.status === "available" ? ("cleared" as const) : ("pending" as const), counterparty: null };
        if (["charge", "payment"].includes(bt.type)) {
          txs.push({ ...base, external_id: bt.id, kind: "income", category: "sales", description: bt.description ?? "Cobro Stripe", amount_minor: Math.abs(bt.amount) });
          if (bt.fee) txs.push({ ...base, external_id: `${bt.id}:fee`, kind: "fee", category: "payment_processing", description: "Comisión Stripe", amount_minor: Math.abs(bt.fee) });
        } else if (["refund", "payment_refund", "dispute", "payment_failure_refund"].includes(bt.type)) {
          txs.push({ ...base, external_id: bt.id, kind: "refund", category: "sales", description: bt.description ?? `Stripe ${bt.type}`, amount_minor: Math.abs(bt.amount) });
        } else if (["stripe_fee", "application_fee", "tax_fee"].includes(bt.type)) {
          txs.push({ ...base, external_id: bt.id, kind: "fee", category: "payment_processing", description: bt.description ?? "Cargo Stripe", amount_minor: Math.abs(bt.amount) });
        }
      }
      if (!data.has_more || !data.data.length) break;
      after = data.data[data.data.length - 1].id;
    }
    const res = await upsertExternalTransactions("stripe", txs);
    // MRR from active subscriptions
    const mrr: Record<string, number> = {};
    let activeSubs = 0;
    let sAfter: string | null = null;
    for (let page = 0; page < 10; page++) {
      const { data } = await withRetry(() =>
        secureJson<{ data: Array<{ id: string; items: { data: Array<{ quantity: number; price: { unit_amount: number | null; currency: string; recurring: { interval: string; interval_count: number } | null } }> } }>; has_more: boolean }>("stripe", {
          url: `https://api.stripe.com/v1/subscriptions?status=active&limit=100${sAfter ? `&starting_after=${sAfter}` : ""}`,
        }),
      );
      activeSubs += data.data.length;
      for (const s of data.data)
        for (const it of s.items.data) {
          const r = it.price.recurring;
          if (!r || it.price.unit_amount == null) continue;
          const perMonth = { day: 30, week: 52 / 12, month: 1, year: 1 / 12 }[r.interval] ?? 1;
          const cur = it.price.currency.toUpperCase();
          mrr[cur] = (mrr[cur] ?? 0) + (it.price.unit_amount * (it.quantity || 1) * perMonth) / r.interval_count;
        }
      if (!data.has_more || !data.data.length) break;
      sAfter = data.data[data.data.length - 1].id;
    }
    const today = todayStr();
    await upsertObservations([
      { project_id: project, metric_key: "active_subscriptions", value: activeSubs, unit: "count", period_start: today, period_end: today, source: "stripe" },
      ...Object.entries(mrr).map(([cur, v]) => ({ project_id: project, metric_key: "mrr", value: Math.round(v), unit: "money", currency: cur, period_start: today, period_end: today, source: "stripe", source_ref: cur })),
    ]);
    return { fetched, upserted: res.inserted + res.updated, cursor: String(maxCreated), details: `${res.inserted} nuevas, ${res.updated} actualizadas · ${activeSubs} suscripciones activas` };
  },
};

// ---------------------------------------------------------------- Mercado Pago
interface MpPayment {
  id: number;
  status: string;
  date_created: string;
  date_approved: string | null;
  transaction_amount: number;
  transaction_amount_refunded: number;
  currency_id: string;
  description: string | null;
  fee_details: Array<{ amount: number; type: string }>;
  payer?: { email?: string | null };
}

export const mercadoPagoConnector: ConnectorDef = {
  id: "mercadopago",
  name: "Mercado Pago",
  category: "finance",
  description: "Pagos recibidos, comisiones y reembolsos.",
  availability: "available",
  auth: "token",
  secretKey: "mercadopago",
  secretLabel: "Access token de producción (APP_USR-…)",
  permissions: ["Lectura de pagos (/v1/payments/search)"],
  setup: [
    "Mercado Pago Developers → Tus integraciones → Crear aplicación (o usar una existente).",
    "Credenciales de producción → copiá el Access Token.",
    "Pegalo acá (se guarda en el Llavero) y elegí el proyecto asociado.",
    "Alternativa sin token: exportá el reporte de ‘Dinero en cuenta’ y usá Importación CSV.",
  ],
  docsUrl: "https://www.mercadopago.com.ar/developers/es/reference/payments/_payments_search/get",
  limitations: [
    "Mercado Pago no ofrece tokens de solo lectura; Sovare HQ solo hace consultas GET.",
    "Se importan pagos de los últimos 90 días en la primera sincronización (máx. 1000 por ejecución).",
  ],
  incremental: true,
  syncEveryMinutes: 120,
  configFields: [projectField],
  test: async () => {
    const { data } = await withRetry(() => secureJson<{ id: number; nickname: string; site_id: string }>("mercadopago", { url: "https://api.mercadopago.com/users/me" }));
    return { ok: true, message: `Conectado como ${data.nickname} (${data.site_id})`, accountLabel: data.nickname };
  },
  sync: async (ctx) => {
    const project = ctx.config.project_id || null;
    const begin = ctx.cursor ? new Date(Date.parse(ctx.cursor) - 3 * 86400_000) : new Date(Date.now() - 90 * 86400_000);
    const txs: ExternalTx[] = [];
    let fetched = 0;
    for (let offset = 0; offset < 1000; offset += 50) {
      const url = `https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&range=date_created&begin_date=${encodeURIComponent(begin.toISOString())}&end_date=NOW&limit=50&offset=${offset}`;
      const { data } = await withRetry(() => secureJson<{ results: MpPayment[]; paging: { total: number } }>("mercadopago", { url }));
      fetched += data.results.length;
      for (const p of data.results) {
        const cur = p.currency_id.toUpperCase();
        const day = (p.date_approved ?? p.date_created).slice(0, 10);
        const base = { project_id: project, currency: cur, occurred_on: day, counterparty: p.payer?.email ?? null };
        if (["approved", "refunded", "partially_refunded", "charged_back"].includes(p.status) || ["pending", "in_process", "authorized"].includes(p.status)) {
          const pending = ["pending", "in_process", "authorized"].includes(p.status);
          txs.push({ ...base, external_id: String(p.id), kind: "income", category: "sales", description: p.description ?? "Pago Mercado Pago", amount_minor: toMinor(p.transaction_amount, cur), status: pending ? "pending" : "cleared" });
          const fee = p.fee_details.reduce((s, f) => s + f.amount, 0);
          if (fee > 0 && !pending) txs.push({ ...base, external_id: `${p.id}:fee`, kind: "fee", category: "payment_processing", description: "Comisión Mercado Pago", amount_minor: toMinor(fee, cur), status: "cleared" });
          const refunded = p.status === "refunded" || p.status === "charged_back" ? p.transaction_amount : p.transaction_amount_refunded;
          if (refunded > 0) txs.push({ ...base, external_id: `${p.id}:refund`, kind: "refund", category: "sales", description: `Reembolso MP (${p.status})`, amount_minor: toMinor(refunded, cur), status: "cleared" });
        }
      }
      if (offset + 50 >= data.paging.total || !data.results.length) break;
    }
    const res = await upsertExternalTransactions("mercadopago", txs);
    return { fetched, upserted: res.inserted + res.updated, cursor: new Date().toISOString(), details: `${fetched} pagos · ${res.inserted} movimientos nuevos` };
  },
};

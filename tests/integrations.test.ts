/**
 * Connector tests against SIMULATED provider APIs: global fetch is replaced by a router that
 * returns canned GitHub / Vercel / Stripe / Mercado Pago / Meta / DolarAPI responses. The real
 * secure-request path is exercised (browser fallback: encrypted secret in fake IndexedDB).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb } from "./helpers/db";
import { db } from "@/db";
import { syncConnector, connectorStates, saveConfig, testConnection } from "@/integrations/runner";
import { withRetry, nextLink } from "@/integrations/retry";
import { HttpError, secureRequest, publicRequest, parseOrThrow } from "@/platform/http";
import { setSecret, deleteSecret, secretStatus } from "@/platform/secrets";
import { setMapping, listRuns, getIntegrationRow } from "@/repos/integrations";
import { createProject } from "@/repos/projects";
import { listTransactions } from "@/repos/finance";
import { evaluateAlerts } from "@/repos/alerts";
import { summarize } from "@/domain/finance";

interface Route {
  host: string;
  path: string;
  query?: Record<string, string>;
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

let routes: Route[] = [];
let calls: Array<{ url: string; headers: Record<string, string> }> = [];

const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  calls.push({ url: url.href, headers: { ...((init?.headers ?? {}) as Record<string, string>) } });
  const r = routes.find((x) => x.host === url.hostname && x.path === url.pathname && Object.entries(x.query ?? {}).every(([k, v]) => url.searchParams.get(k) === v));
  if (!r) return new Response(JSON.stringify({ message: `no route for ${url.pathname}` }), { status: 404 });
  return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
});

const route = (r: Route) => {
  // more specific (with query) routes first
  routes = r.query ? [r, ...routes] : [...routes, r];
};
const count = async (sql: string, params: (string | number)[] = []) => (await db().select<{ n: number }>(sql, params))[0].n;
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

beforeEach(async () => {
  routes = [];
  calls = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  await freshDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------------ retry helpers
describe("withRetry / nextLink", () => {
  it("retries retryable errors (429, 5xx, network) and returns the eventual result", async () => {
    for (const err of [new HttpError("HTTP 429", 429, "rate_limited", true), new HttpError("HTTP 503", 503, "http_error", true), new HttpError("red", null, "network", true)]) {
      let n = 0;
      const fn = vi.fn(async () => {
        if (n++ < 2) throw err;
        return "ok";
      });
      await expect(withRetry(fn, 3, 1)).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledTimes(3);
    }
  });

  it("does not retry 4xx or unknown errors, and gives up after the attempts", async () => {
    const unauthorized = vi.fn(async () => {
      throw new HttpError("HTTP 401", 401, "unauthorized", false);
    });
    await expect(withRetry(unauthorized, 3, 1)).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledTimes(1);

    const plain = vi.fn(async () => {
      throw new Error("bug");
    });
    await expect(withRetry(plain, 3, 1)).rejects.toThrow("bug");
    expect(plain).toHaveBeenCalledTimes(1);

    const always = vi.fn(async () => {
      throw new HttpError("HTTP 502", 502, "http_error", true);
    });
    await expect(withRetry(always, 3, 1)).rejects.toMatchObject({ status: 502 });
    expect(always).toHaveBeenCalledTimes(3);
  });

  it("parseOrThrow marks 429/5xx retryable and 4xx not", () => {
    const res = (status: number, body = "{}") => ({ status, headers: {}, body, latencyMs: 1 });
    expect(() => parseOrThrow(res(429))).toThrow(expect.objectContaining({ retryable: true, code: "rate_limited" }));
    expect(() => parseOrThrow(res(500))).toThrow(expect.objectContaining({ retryable: true }));
    expect(() => parseOrThrow(res(404))).toThrow(expect.objectContaining({ retryable: false, code: "not_found" }));
    expect(() => parseOrThrow(res(401, JSON.stringify({ message: "Bad credentials" })))).toThrow("HTTP 401: Bad credentials");
    expect(() => parseOrThrow(res(200, "<html>"))).toThrow(expect.objectContaining({ code: "invalid_json" }));
    expect(parseOrThrow<{ a: number }>(res(200, '{"a":1}'))).toEqual({ a: 1 });
  });

  it("nextLink parses RFC 5988 Link headers", () => {
    const h = '<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=5>; rel="last"';
    expect(nextLink(h)).toBe("https://api.github.com/user/repos?page=2");
    expect(nextLink('<https://api.github.com/user/repos?page=1>; rel="prev"')).toBeNull();
    expect(nextLink(undefined)).toBeNull();
    expect(nextLink("")).toBeNull();
  });
});

// ------------------------------------------------------------------ secure transport
describe("secure requests", () => {
  it("only sends credentials over HTTPS to the allow-listed host", async () => {
    await setSecret("github", "ghp_test_TOKEN123");
    await expect(secureRequest("github", { url: "https://evil.example.com/user" })).rejects.toMatchObject({ code: "host_not_allowed" });
    await expect(secureRequest("github", { url: "http://api.github.com/user" })).rejects.toMatchObject({ code: "insecure_url" });
    expect(fetchMock).not.toHaveBeenCalled();
    route({ host: "api.github.com", path: "/user", body: { login: "me" } });
    // caller-provided auth headers are dropped and replaced by the stored credential
    await secureRequest("github", { url: "https://api.github.com/user", headers: { Authorization: "Bearer injected" } });
    expect(calls[0].headers.Authorization).toBe("Bearer ghp_test_TOKEN123");
  });

  it("public requests never carry credentials", async () => {
    await expect(publicRequest({ url: "https://user:pass@dolarapi.com/v1/dolares" })).rejects.toMatchObject({ code: "invalid_url" });
    await expect(publicRequest({ url: "file:///etc/passwd" })).rejects.toMatchObject({ code: "invalid_scheme" });
    route({ host: "dolarapi.com", path: "/v1/dolares", body: [] });
    await publicRequest({ url: "https://dolarapi.com/v1/dolares", headers: { authorization: "x", cookie: "y" } });
    expect(Object.keys(calls[0].headers).map((k) => k.toLowerCase())).not.toContain("authorization");
    expect(Object.keys(calls[0].headers).map((k) => k.toLowerCase())).not.toContain("cookie");
  });

  it("secretStatus reports stored credentials without revealing them", async () => {
    await setSecret("stripe", "rk_test_abc");
    await deleteSecret("vercel");
    expect(await secretStatus(["stripe", "vercel"])).toEqual({ stripe: true, vercel: false });
    await expect(setSecret("stripe", "   ")).rejects.toThrow();
  });
});

// ------------------------------------------------------------------ GitHub
const GH = "api.github.com";
const ghRepo = (full: string, extra: Record<string, unknown> = {}) => ({
  id: full.length,
  full_name: full,
  html_url: `https://github.com/${full}`,
  default_branch: "main",
  description: `Repo ${full}`,
  language: "TypeScript",
  private: true,
  archived: false,
  open_issues_count: 3,
  stargazers_count: 4,
  pushed_at: "2026-11-06T10:00:00Z",
  ...extra,
});

function githubApi() {
  const R = "/repos/sovare/gastro-os";
  route({ host: GH, path: "/user", body: { login: "sovare-dev", name: "Sovare" } });
  route({ host: GH, path: "/user/repos", body: [ghRepo("sovare/gastro-os")], headers: { link: '<https://api.github.com/user/repos?page=2&per_page=100>; rel="next", <https://api.github.com/user/repos?page=2&per_page=100>; rel="last"' } });
  route({ host: GH, path: "/user/repos", query: { page: "2" }, body: [ghRepo("sovare/memo", { private: false })] });
  route({ host: GH, path: `${R}/commits`, body: [{ sha: "abc123", html_url: "https://github.com/sovare/gastro-os/commit/abc123", commit: { message: "feat: login\n\nlong body", author: { name: "Dev", date: "2026-11-06T09:00:00Z" } }, author: { login: "dev" } }] });
  route({
    host: GH,
    path: `${R}/pulls`,
    body: [
      { id: 1, number: 7, title: "Login", state: "closed", merged_at: "2026-11-06T12:00:00Z", html_url: "https://github.com/sovare/gastro-os/pull/7", user: { login: "dev" }, created_at: "2026-11-05T10:00:00Z", updated_at: "2026-11-06T12:00:00Z", closed_at: "2026-11-06T12:00:00Z", draft: false },
      { id: 2, number: 8, title: "WIP menu", state: "open", merged_at: null, html_url: "https://github.com/sovare/gastro-os/pull/8", user: { login: "dev" }, created_at: "2026-11-06T10:00:00Z", updated_at: "2026-11-06T10:00:00Z", closed_at: null, draft: true },
    ],
  });
  route({
    host: GH,
    path: `${R}/issues`,
    body: [
      { id: 10, number: 3, title: "Bug en caja", state: "closed", html_url: "https://github.com/sovare/gastro-os/issues/3", user: { login: "qa" }, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-06T08:00:00Z", closed_at: "2026-11-06T08:00:00Z", labels: [{ name: "bug" }] },
      { id: 11, number: 8, title: "WIP menu", state: "open", html_url: "x", user: null, created_at: "2026-11-06T10:00:00Z", updated_at: "2026-11-06T10:00:00Z", closed_at: null, pull_request: {}, labels: [] },
    ],
  });
  route({
    host: GH,
    path: `${R}/releases`,
    body: [
      { id: 99, tag_name: "v1.0.0", name: "v1.0.0", html_url: "https://github.com/sovare/gastro-os/releases/v1.0.0", published_at: "2026-11-06T13:00:00Z", created_at: "2026-11-06T13:00:00Z", draft: false, prerelease: false },
      { id: 100, tag_name: "v1.1.0", name: null, html_url: "x", published_at: null, created_at: "2026-11-06T14:00:00Z", draft: true, prerelease: false },
    ],
  });
  route({ host: GH, path: `${R}/actions/runs`, body: { workflow_runs: [{ id: 5, name: "CI", status: "completed", conclusion: "failure", html_url: "https://github.com/sovare/gastro-os/actions/runs/5", created_at: "2026-11-06T09:05:00Z", updated_at: "2026-11-06T09:10:00Z", head_branch: "main", event: "push" }] } });
}

describe("GitHub connector", () => {
  it("syncs repositories (paginated), dev items for linked repos and activity", async () => {
    await setSecret("github", "ghp_test_TOKEN123");
    const pid = await createProject({ name: "GastroOS", status: "development" });
    await setMapping("github", "sovare/gastro-os", pid, "sovare/gastro-os");
    githubApi();

    const res = await syncConnector("github");
    expect(res.ok).toBe(true);

    const repos = await db().select<{ canonical_key: string; project_id: string | null; is_private: number; open_prs: number; open_issues: number; last_commit_sha: string; last_commit_message: string }>("SELECT * FROM repositories ORDER BY canonical_key");
    expect(repos.map((r) => [r.canonical_key, r.project_id, r.is_private])).toEqual([
      ["github.com/sovare/gastro-os", pid, 1],
      ["github.com/sovare/memo", null, 0],
    ]);
    expect(repos[0]).toMatchObject({ open_prs: 1, open_issues: 2, last_commit_sha: "abc123", last_commit_message: "feat: login" });

    const items = await db().select<{ kind: string; external_id: string; state: string | null; project_id: string }>("SELECT kind, external_id, state, project_id FROM dev_items ORDER BY kind, external_id");
    expect(items.map((i) => [i.kind, i.external_id, i.state])).toEqual([
      ["commit", "sovare/gastro-os@abc123", null],
      ["issue", "sovare/gastro-os#3", "closed"],
      ["pull_request", "sovare/gastro-os#pr7", "merged"],
      ["pull_request", "sovare/gastro-os#pr8", "open"],
      ["release", "sovare/gastro-os@release99", "published"],
      ["workflow_run", "sovare/gastro-os@run5", "failure"],
    ]);
    expect(items.every((i) => i.project_id === pid)).toBe(true);

    const types = (await db().select<{ type: string }>("SELECT type FROM activity_events WHERE source = 'github' ORDER BY type")).map((r) => r.type);
    expect(types).toEqual(["commit", "issue_closed", "pr_merged", "release", "workflow_failed"]);

    const runs = await listRuns("github");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "success", items_fetched: 2, items_upserted: 8 });
    const row = (await getIntegrationRow("github"))!;
    expect(row).toMatchObject({ status: "connected", enabled: true, account_label: "sovare-dev", last_error: null, retry_count: 0 });
    expect(JSON.parse(row.sync_cursor!)).toHaveProperty(["sovare/gastro-os"]);

    // the token travelled only in the Authorization header to api.github.com
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls) {
      expect(new URL(c.url).hostname).toBe(GH);
      expect(c.headers.Authorization).toBe("Bearer ghp_test_TOKEN123");
      expect(c.url).not.toContain("TOKEN123");
    }
    expect(calls.some((c) => c.url.includes("page=2"))).toBe(true);

    // second sync is idempotent
    expect((await syncConnector("github")).ok).toBe(true);
    expect(await count("SELECT count(*) AS n FROM dev_items")).toBe(6);
    expect(await count("SELECT count(*) AS n FROM repositories")).toBe(2);
    expect(await count("SELECT count(*) AS n FROM activity_events WHERE source = 'github'")).toBe(5);
    expect(await listRuns("github")).toHaveLength(2);
  });

  it("a 401 sets status 'error' with a sanitized last_error (no secret text)", async () => {
    await setSecret("github", "ghp_test_TOKEN123");
    // first a successful sync (integration becomes enabled), then the token is revoked
    route({ host: GH, path: "/user", body: { login: "sovare-dev" } });
    route({ host: GH, path: "/user/repos", body: [] });
    expect((await syncConnector("github")).ok).toBe(true);
    routes = [];
    fetchMock.mockClear();
    route({ host: GH, path: "/user", status: 401, body: { message: "Bad credentials for ghp_test_TOKEN123 (Bearer ghp_test_TOKEN123)" } });
    const res = await syncConnector("github");
    expect(res.ok).toBe(false);
    expect(res.message).not.toContain("TOKEN123");
    const row = (await getIntegrationRow("github"))!;
    expect(row.status).toBe("error");
    expect(row.last_error).toMatch(/^HTTP 401/);
    expect(row.last_error).not.toContain("TOKEN123");
    expect(row.retry_count).toBe(1);
    const runs = await listRuns("github");
    expect(runs.map((r) => r.status).sort()).toEqual(["error", "success"]);
    const run = runs.find((r) => r.status === "error")!;
    expect(run).toMatchObject({ items_fetched: 0, items_upserted: 0 });
    expect(run.finished_at).toBeTruthy();
    expect(row.last_success_at).toBeTruthy(); // stale data is still known to be from the last success
    expect(run.error).not.toContain("TOKEN123");
    const ev = await db().select<{ detail: string }>("SELECT detail FROM activity_events WHERE type = 'integration_error'");
    expect(ev).toHaveLength(1);
    expect(ev[0].detail).not.toContain("TOKEN123");
    // 401 is not retried
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // the integration_error alert rule picks it up
    const alerts = await evaluateAlerts("2026-11-07");
    expect(alerts.filter((a) => a.rule_id === "integration_error")).toHaveLength(1);
    // a second failure increments the retry counter
    await syncConnector("github");
    expect((await getIntegrationRow("github"))!.retry_count).toBe(2);
  });

  it("without a stored credential the sync fails cleanly", async () => {
    await deleteSecret("github");
    const res = await syncConnector("github");
    expect(res.ok).toBe(false);
    expect((await getIntegrationRow("github"))!.status).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("testConnection stores the account label; connectorStates reflects credentials", async () => {
    await setSecret("github", "ghp_test_TOKEN123");
    route({ host: GH, path: "/user", body: { login: "sovare-dev", name: null } });
    const before = (await connectorStates()).find((s) => s.def.id === "github")!;
    expect(before).toMatchObject({ hasCredential: true, status: "needs_setup" });
    expect(await testConnection("github")).toMatchObject({ ok: true, accountLabel: "sovare-dev" });
    const states = await connectorStates();
    expect(states.find((s) => s.def.id === "github")).toMatchObject({ status: "connected", accountLabel: "sovare-dev" });
    expect(states.find((s) => s.def.id === "railway")!.status).toBe("unsupported");
    expect(states.find((s) => s.def.id === "google_ads")!.status).toBe("unsupported");
  });
});

// ------------------------------------------------------------------ Vercel
describe("Vercel connector", () => {
  it("normalizes deployments, maps projects and feeds the deploy_failed alert", async () => {
    await setSecret("vercel", "vercel_tok_1");
    const pid = await createProject({ name: "GastroOS", status: "production" });
    await setMapping("vercel", "prj_1", pid);
    route({
      host: "api.vercel.com",
      path: "/v6/deployments",
      body: {
        deployments: [
          { uid: "dpl_ok", name: "gastro", projectId: "prj_1", url: "gastro-ok.vercel.app", readyState: "READY", target: "production", created: Date.parse("2026-11-06T10:00:00Z"), ready: Date.parse("2026-11-06T10:02:00Z"), inspectorUrl: "https://vercel.com/i/ok", meta: { githubCommitSha: "abc", githubCommitMessage: "feat", githubCommitRef: "main" } },
          { uid: "dpl_err", name: "gastro", projectId: "prj_1", url: "gastro-err.vercel.app", state: "ERROR", target: null, created: Date.parse("2026-11-06T11:00:00Z"), inspectorUrl: "https://vercel.com/i/err" },
          { uid: "dpl_other", name: "landing", projectId: "prj_unmapped", url: "landing.vercel.app", readyState: "BUILDING", target: "production", created: Date.parse("2026-11-06T12:00:00Z") },
        ],
      },
    });
    expect((await syncConnector("vercel")).ok).toBe(true);
    const deps = await db().select<{ external_id: string; status: string; project_id: string | null; environment: string; url: string; commit_sha: string | null; finished_at_ext: string | null }>("SELECT * FROM deployments ORDER BY external_id");
    expect(deps.map((d) => [d.external_id, d.status, d.project_id, d.environment])).toEqual([
      ["dpl_err", "error", pid, "preview"],
      ["dpl_ok", "ready", pid, "production"],
      ["dpl_other", "building", null, "production"],
    ]);
    expect(deps[1]).toMatchObject({ url: "https://gastro-ok.vercel.app", commit_sha: "abc", finished_at_ext: "2026-11-06T10:02:00.000Z" });
    const types = (await db().select<{ type: string }>("SELECT type FROM activity_events WHERE source = 'vercel' ORDER BY type")).map((r) => r.type);
    expect(types).toEqual(["deploy", "deploy_failed"]);
    expect((await listRuns("vercel"))[0]).toMatchObject({ status: "success", items_fetched: 3, items_upserted: 3 });

    const alerts = (await evaluateAlerts("2026-11-07")).filter((a) => a.rule_id === "deploy_failed");
    expect(alerts.map((a) => a.fingerprint)).toEqual(["deploy_failed:vercel:dpl_err"]);
  });
});

// ------------------------------------------------------------------ Stripe
function stripeApi(eurStatus: "pending" | "available") {
  route({
    host: "api.stripe.com",
    path: "/v1/balance_transactions",
    body: {
      has_more: false,
      data: [
        { id: "txn_1", amount: 5000, fee: 175, currency: "usd", created: unix("2026-11-01T12:00:00Z"), status: "available", type: "charge", description: "Plan Pro", reporting_category: "charge" },
        { id: "txn_2", amount: -2000, fee: 0, currency: "usd", created: unix("2026-11-02T12:00:00Z"), status: "available", type: "refund", description: null, reporting_category: "refund" },
        { id: "txn_3", amount: 4500, fee: 160, currency: "eur", created: unix("2026-11-03T12:00:00Z"), status: eurStatus, type: "charge", description: "Plan Pro EU", reporting_category: "charge" },
        { id: "txn_4", amount: -300, fee: 0, currency: "usd", created: unix("2026-11-04T12:00:00Z"), status: "available", type: "stripe_fee", description: "Billing", reporting_category: "fee" },
        { id: "txn_5", amount: -10000, fee: 0, currency: "usd", created: unix("2026-11-05T12:00:00Z"), status: "available", type: "payout", description: "Payout", reporting_category: "payout" },
      ],
    },
  });
  route({
    host: "api.stripe.com",
    path: "/v1/subscriptions",
    body: {
      has_more: false,
      data: [
        { id: "sub_1", items: { data: [{ quantity: 2, price: { unit_amount: 1000, currency: "usd", recurring: { interval: "month", interval_count: 1 } } }] } },
        { id: "sub_2", items: { data: [{ quantity: 1, price: { unit_amount: 12000, currency: "usd", recurring: { interval: "year", interval_count: 1 } } }] } },
      ],
    },
  });
}

describe("Stripe connector", () => {
  it("separates income, fees and refunds, preserves currencies and computes MRR", async () => {
    await setSecret("stripe", "rk_test_abc123");
    const pid = await createProject({ name: "CosovGO" });
    await saveConfig("stripe", { project_id: pid });
    stripeApi("pending");
    expect((await syncConnector("stripe")).ok).toBe(true);

    const txs = await listTransactions();
    const rows = txs.map((t) => [t.external_id, t.kind, t.category, t.amount_minor, t.currency, t.status]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(rows).toEqual([
      ["txn_1", "income", "sales", 5000, "USD", "cleared"],
      ["txn_1:fee", "fee", "payment_processing", 175, "USD", "cleared"],
      ["txn_2", "refund", "sales", 2000, "USD", "cleared"],
      ["txn_3", "income", "sales", 4500, "EUR", "pending"],
      ["txn_3:fee", "fee", "payment_processing", 160, "EUR", "pending"],
      ["txn_4", "fee", "payment_processing", 300, "USD", "cleared"],
    ]);
    expect(txs.every((t) => t.project_id === pid && t.source === "stripe")).toBe(true);
    const s = summarize(txs);
    expect(s.USD).toMatchObject({ netRevenue: 3000, fees: 475, operatingProfit: 2525 });
    expect(s.EUR).toMatchObject({ grossBilling: 4500, collected: 0, pendingIncome: 4500 });

    const obs = await db().select<{ metric_key: string; value: number; currency: string | null }>("SELECT metric_key, value, currency FROM metric_observations ORDER BY metric_key");
    expect(obs).toEqual([
      { metric_key: "active_subscriptions", value: 2, currency: null },
      { metric_key: "mrr", value: 3000, currency: "USD" },
    ]);
    const row = (await getIntegrationRow("stripe"))!;
    expect(row.status).toBe("connected");
    expect(Number(row.sync_cursor)).toBe(unix("2026-11-05T12:00:00Z"));

    // the EUR charge becomes available: updated in place, no duplicates
    routes = [];
    stripeApi("available");
    expect((await syncConnector("stripe")).ok).toBe(true);
    const after = await listTransactions();
    expect(after).toHaveLength(6);
    expect(after.filter((t) => t.external_id?.startsWith("txn_3")).map((t) => t.status)).toEqual(["cleared", "cleared"]);
    expect(await count("SELECT count(*) AS n FROM metric_observations")).toBe(2);
    expect(await count("SELECT count(*) AS n FROM activity_events WHERE type = 'sale' AND source = 'stripe'")).toBe(2);
  });
});

// ------------------------------------------------------------------ Mercado Pago
describe("Mercado Pago connector", () => {
  it("imports payments with fees/refunds separated and currencies preserved", async () => {
    await setSecret("mercadopago", "APP_USR-1234-abcd");
    await saveConfig("mercadopago", { project_id: "" });
    const p = (id: number, extra: Record<string, unknown>) => ({ id, status: "approved", date_created: "2026-11-01T10:00:00.000-03:00", date_approved: "2026-11-01T10:05:00.000-03:00", transaction_amount: 0, transaction_amount_refunded: 0, currency_id: "ARS", description: `Pedido ${id}`, fee_details: [], payer: { email: "cliente@example.com" }, ...extra });
    route({
      host: "api.mercadopago.com",
      path: "/v1/payments/search",
      body: {
        paging: { total: 5 },
        results: [
          p(1001, { transaction_amount: 1500.5, fee_details: [{ amount: 60.02, type: "mercadopago_fee" }, { amount: 15.01, type: "financing_fee" }] }),
          p(1002, { status: "partially_refunded", transaction_amount: 1000, transaction_amount_refunded: 200, fee_details: [{ amount: 40, type: "mercadopago_fee" }] }),
          p(1003, { status: "pending", date_approved: null, date_created: "2026-11-03T10:00:00.000-03:00", transaction_amount: 500, fee_details: [{ amount: 20, type: "mercadopago_fee" }] }),
          p(1004, { status: "rejected", transaction_amount: 999 }),
          p(1005, { currency_id: "USD", transaction_amount: 10 }),
        ],
      },
    });
    expect((await syncConnector("mercadopago")).ok).toBe(true);
    const rows = (await listTransactions()).map((t) => [t.external_id, t.kind, t.amount_minor, t.currency, t.status]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(rows).toEqual([
      ["1001", "income", 150_050, "ARS", "cleared"],
      ["1001:fee", "fee", 7_503, "ARS", "cleared"],
      ["1002", "income", 100_000, "ARS", "cleared"],
      ["1002:fee", "fee", 4_000, "ARS", "cleared"],
      ["1002:refund", "refund", 20_000, "ARS", "cleared"],
      ["1003", "income", 50_000, "ARS", "pending"],
      ["1005", "income", 1_000, "USD", "cleared"],
    ]);
    const t1001 = (await listTransactions()).find((t) => t.external_id === "1001")!;
    expect(t1001).toMatchObject({ counterparty: "cliente@example.com", occurred_on: "2026-11-01", project_id: null });
    expect((await listRuns("mercadopago"))[0]).toMatchObject({ status: "success", items_fetched: 5, items_upserted: 7 });
    // the token never appears in a URL
    expect(calls.every((c) => !c.url.includes("APP_USR"))).toBe(true);
  });
});

// ------------------------------------------------------------------ Meta Ads
function metaApi() {
  const G = "graph.facebook.com";
  route({ host: G, path: "/v23.0/act_123", body: { currency: "USD", name: "Sovare Ads" } });
  route({
    host: G,
    path: "/v23.0/act_123/campaigns",
    body: {
      data: [
        { id: "c1", name: "Promo GastroOS", objective: "OUTCOME_SALES", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "2000", start_time: "2026-10-01T00:00:00-0300" },
        { id: "c2", name: "Brand", status: "PAUSED", effective_status: "PAUSED", lifetime_budget: "50000" },
      ],
    },
  });
  route({
    host: G,
    path: "/v23.0/act_123/insights",
    body: {
      data: [
        { campaign_id: "c1", date_start: "2026-11-05", impressions: "1000", reach: "800", clicks: "25", spend: "12.34", actions: [{ action_type: "purchase", value: "2" }, { action_type: "link_click", value: "25" }], action_values: [{ action_type: "purchase", value: "80.5" }] },
        { campaign_id: "c1", date_start: "2026-11-06", impressions: "500", clicks: "5", spend: "5", actions: [{ action_type: "link_click", value: "5" }] },
        { campaign_id: "ghost", date_start: "2026-11-06", impressions: "1", spend: "1" },
      ],
    },
  });
}

describe("Meta Ads connector", () => {
  it("stores campaigns and daily metrics; conversions stay null without a conversion action", async () => {
    await setSecret("meta_ads", "EAAB-test-token");
    const pid = await createProject({ name: "GastroOS" });
    await saveConfig("meta_ads", { ad_account_id: "123", project_id: pid });
    metaApi();
    expect((await syncConnector("meta_ads")).ok).toBe(true);

    const camps = await db().select<{ external_id: string; status: string; project_id: string; daily_budget_minor: number | null; lifetime_budget_minor: number | null; currency: string; account_id: string; start_on: string | null }>("SELECT * FROM campaigns ORDER BY external_id");
    expect(camps.map((c) => [c.external_id, c.status, c.project_id, c.daily_budget_minor, c.lifetime_budget_minor, c.currency, c.account_id])).toEqual([
      ["c1", "ACTIVE", pid, 2000, null, "USD", "act_123"],
      ["c2", "PAUSED", pid, null, 50000, "USD", "act_123"],
    ]);
    expect(camps[0].start_on).toBe("2026-10-01");

    const m = await db().select<{ date: string; impressions: number; reach: number | null; clicks: number; spend_minor: number; conversions: number | null; conversion_value_minor: number | null; conversion_label: string | null }>("SELECT * FROM ad_metrics ORDER BY date");
    expect(m).toEqual([
      expect.objectContaining({ date: "2026-11-05", impressions: 1000, reach: 800, clicks: 25, spend_minor: 1234, conversions: null, conversion_value_minor: null, conversion_label: null }),
      expect.objectContaining({ date: "2026-11-06", impressions: 500, reach: null, clicks: 5, spend_minor: 500, conversions: null, conversion_value_minor: null }),
    ]);
    const row = (await getIntegrationRow("meta_ads"))!;
    expect(row).toMatchObject({ status: "connected", account_label: "Sovare Ads" });
    expect(row.sync_cursor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await count("SELECT count(*) AS n FROM activity_events WHERE type = 'campaign_started'")).toBe(2);
  });

  it("counts conversions (0 when not reported for a day) once a conversion action is configured", async () => {
    await setSecret("meta_ads", "EAAB-test-token");
    await saveConfig("meta_ads", { ad_account_id: "act_123", conversion_action: "purchase" });
    metaApi();
    expect((await syncConnector("meta_ads")).ok).toBe(true);
    const m = await db().select<{ date: string; conversions: number | null; conversion_value_minor: number | null; conversion_label: string | null }>("SELECT date, conversions, conversion_value_minor, conversion_label FROM ad_metrics ORDER BY date");
    expect(m).toEqual([
      { date: "2026-11-05", conversions: 2, conversion_value_minor: 8050, conversion_label: "purchase" },
      { date: "2026-11-06", conversions: 0, conversion_value_minor: null, conversion_label: "purchase" },
    ]);
    // re-sync does not duplicate rows
    expect((await syncConnector("meta_ads")).ok).toBe(true);
    expect(await count("SELECT count(*) AS n FROM ad_metrics")).toBe(2);
    expect(await count("SELECT count(*) AS n FROM campaigns")).toBe(2);
  });

  it("fails with a clear error when the ad account is not configured", async () => {
    await setSecret("meta_ads", "EAAB-test-token");
    const res = await syncConnector("meta_ads");
    expect(res).toMatchObject({ ok: false, message: "Falta el ID de la cuenta publicitaria" });
    expect((await getIntegrationRow("meta_ads"))!.status).toBe("error");
  });
});

// ------------------------------------------------------------------ DolarAPI
describe("DolarAPI connector", () => {
  it("stores the exchange rate with source and date", async () => {
    await saveConfig("fx_dolarapi", { casa: "blue" });
    route({ host: "dolarapi.com", path: "/v1/dolares/blue", body: { casa: "blue", compra: 1400, venta: 1430, fechaActualizacion: "2026-11-06T15:00:00.000Z" } });
    expect((await syncConnector("fx_dolarapi")).ok).toBe(true);
    const rates = await db().select<{ base: string; quote: string; rate: number; as_of: string; source: string }>("SELECT base, quote, rate, as_of, source FROM exchange_rates");
    expect(rates).toEqual([{ base: "USD", quote: "ARS", rate: 1430, as_of: "2026-11-06", source: "dolarapi.com · blue (venta)" }]);
    expect(calls[0].headers).not.toHaveProperty("Authorization");
    expect((await getIntegrationRow("fx_dolarapi"))!.status).toBe("connected");
  });

  it("rejects invalid quotes", async () => {
    route({ host: "dolarapi.com", path: "/v1/dolares/oficial", body: { casa: "oficial", compra: 0, venta: 0, fechaActualizacion: "2026-11-06T15:00:00.000Z" } });
    const res = await syncConnector("fx_dolarapi");
    expect(res.ok).toBe(false);
    expect(await count("SELECT count(*) AS n FROM exchange_rates")).toBe(0);
    expect((await getIntegrationRow("fx_dolarapi"))!).toMatchObject({ status: "error", last_error: "Cotización inválida recibida" });
  });
});

describe("runner", () => {
  it("refuses connectors without sync", async () => {
    expect(await syncConnector("railway")).toMatchObject({ ok: false });
    expect(await syncConnector("does-not-exist")).toMatchObject({ ok: false });
  });
});

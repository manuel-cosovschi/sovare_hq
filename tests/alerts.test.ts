import { describe, expect, it } from "vitest";
import { evaluateRules, RULES, type AlertSnapshot } from "@/domain/alertRules";
import type { TxLike } from "@/domain/finance";

const TODAY = "2026-11-07";

const snap = (p: Partial<AlertSnapshot> = {}): AlertSnapshot => ({
  today: TODAY,
  projects: [],
  deployments: [],
  campaigns: [],
  txs: [],
  tasks: [],
  recurring: [],
  integrations: [],
  health: [],
  budgets: [],
  ...p,
});

const byRule = (s: AlertSnapshot, rule: string, configs = {}) => evaluateRules(s, configs).filter((a) => a.rule_id === rule);

const tx = (p: Partial<TxLike> & Pick<TxLike, "kind" | "amount_minor" | "occurred_on">): TxLike => ({ category: "other", currency: "USD", status: "cleared", project_id: null, deleted_at: null, ...p });

const deploy = (p: Partial<AlertSnapshot["deployments"][number]>) => ({
  project_id: "p1",
  provider: "vercel",
  provider_project: "gastro",
  status: "ready",
  created_at_ext: "2026-11-06T10:00:00.000Z",
  external_id: "d",
  inspect_url: null,
  ...p,
});

describe("evaluateRules", () => {
  it("an empty snapshot produces no alerts", () => {
    expect(evaluateRules(snap(), {})).toEqual([]);
  });

  describe("deploy_failed", () => {
    it("fires when the LATEST deploy errored", () => {
      const s = snap({
        projects: [{ id: "p1", name: "GastroOS", status: "production", last_activity_at: null, target_launch_on: null }],
        deployments: [deploy({ external_id: "old", status: "ready", created_at_ext: "2026-11-05T10:00:00Z" }), deploy({ external_id: "new", status: "error", created_at_ext: "2026-11-06T10:00:00Z", inspect_url: "https://vercel.com/i/new" })],
      });
      const a = byRule(s, "deploy_failed");
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ fingerprint: "deploy_failed:vercel:new", severity: "critical", project_id: "p1", link: "https://vercel.com/i/new" });
      expect(a[0].title).toContain("GastroOS");
    });

    it("does not fire when a later deploy succeeded, or the failure is too old", () => {
      const fixed = snap({ deployments: [deploy({ external_id: "e", status: "error", created_at_ext: "2026-11-05T10:00:00Z" }), deploy({ external_id: "r", status: "ready", created_at_ext: "2026-11-06T10:00:00Z" })] });
      expect(byRule(fixed, "deploy_failed")).toEqual([]);
      const old = snap({ deployments: [deploy({ external_id: "e", status: "error", created_at_ext: "2026-10-01T10:00:00Z" })] });
      expect(byRule(old, "deploy_failed")).toEqual([]);
    });

    it("tracks latest deploy per provider project independently", () => {
      const s = snap({ deployments: [deploy({ provider_project: "a", external_id: "a1", status: "error" }), deploy({ provider_project: "b", external_id: "b1", status: "ready" })] });
      expect(byRule(s, "deploy_failed").map((a) => a.fingerprint)).toEqual(["deploy_failed:vercel:a1"]);
    });
  });

  describe("ad_no_conversions", () => {
    const camp = (p: Partial<AlertSnapshot["campaigns"][number]>) => ({ id: "c1", name: "Promo", project_id: null, status: "ACTIVE", currency: "USD", spendWindow: 5_000, conversionsWindow: 0 as number | null, spendMonth: 5_000, ...p });

    it("fires only when conversions are reported as 0", () => {
      const a = byRule(snap({ campaigns: [camp({})] }), "ad_no_conversions");
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ fingerprint: "ad_no_conversions:c1:2026-11", severity: "warning" });
      expect(a[0].evidence).toMatchObject({ conversions: 0, spend_minor: 5_000 });
    });

    it("does not fire when conversions are unknown (null), present, spend is low or the campaign is paused", () => {
      expect(byRule(snap({ campaigns: [camp({ conversionsWindow: null })] }), "ad_no_conversions")).toEqual([]);
      expect(byRule(snap({ campaigns: [camp({ conversionsWindow: 3 })] }), "ad_no_conversions")).toEqual([]);
      expect(byRule(snap({ campaigns: [camp({ spendWindow: 2_999 })] }), "ad_no_conversions")).toEqual([]);
      expect(byRule(snap({ campaigns: [camp({ status: "PAUSED" })] }), "ad_no_conversions")).toEqual([]);
    });

    it("ad_spend_threshold fires above the monthly threshold", () => {
      expect(byRule(snap({ campaigns: [camp({ spendMonth: 30_001 })] }), "ad_spend_threshold")).toHaveLength(1);
      expect(byRule(snap({ campaigns: [camp({ spendMonth: 30_000 })] }), "ad_spend_threshold")).toEqual([]);
    });
  });

  describe("project_inactive", () => {
    const proj = (status: string, last: string | null) => ({ id: "p", name: "MEMO", status, last_activity_at: last, target_launch_on: null });
    it("fires for active projects without activity for N days", () => {
      const a = byRule(snap({ projects: [proj("development", "2026-10-10T08:00:00Z")] }), "project_inactive");
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ severity: "info", fingerprint: "project_inactive:p:2026-10-10" });
      expect(a[0].evidence).toMatchObject({ days: 28 });
    });
    it("ignores recent activity, ideas/paused projects and unknown activity", () => {
      expect(byRule(snap({ projects: [proj("development", "2026-11-01T00:00:00Z")] }), "project_inactive")).toEqual([]);
      expect(byRule(snap({ projects: [proj("idea", "2026-01-01T00:00:00Z")] }), "project_inactive")).toEqual([]);
      expect(byRule(snap({ projects: [proj("paused", "2026-01-01T00:00:00Z")] }), "project_inactive")).toEqual([]);
      expect(byRule(snap({ projects: [proj("development", null)] }), "project_inactive")).toEqual([]);
    });
  });

  describe("cost_spike / revenue_drop", () => {
    it("cost_spike compares the last 30 days with the previous 30 (expenses + fees) per currency", () => {
      const s = snap({
        txs: [
          tx({ kind: "expense", amount_minor: 10_000, occurred_on: "2026-09-20" }),
          tx({ kind: "expense", amount_minor: 15_000, occurred_on: "2026-10-20" }),
          tx({ kind: "fee", amount_minor: 5_000, occurred_on: "2026-11-01" }),
          tx({ kind: "expense", amount_minor: 1_000_000, occurred_on: "2026-11-01", currency: "ARS" }), // no previous ARS baseline
        ],
      });
      const a = byRule(s, "cost_spike");
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ fingerprint: "cost_spike:USD:2026-11", evidence: { currency: "USD", current_minor: 20_000, previous_minor: 10_000 } });
      expect(a[0].title).toContain("100%");
    });

    it("cost_spike stays quiet below the threshold", () => {
      const s = snap({ txs: [tx({ kind: "expense", amount_minor: 10_000, occurred_on: "2026-09-20" }), tx({ kind: "expense", amount_minor: 13_000, occurred_on: "2026-10-20" })] });
      expect(byRule(s, "cost_spike")).toEqual([]);
    });

    it("revenue_drop fires when net revenue falls by more than pct", () => {
      const s = snap({ txs: [tx({ kind: "income", amount_minor: 20_000, occurred_on: "2026-09-25" }), tx({ kind: "income", amount_minor: 5_000, occurred_on: "2026-10-25" })] });
      const a = byRule(s, "revenue_drop");
      expect(a).toHaveLength(1);
      expect(a[0].evidence).toMatchObject({ current_minor: 5_000, previous_minor: 20_000 });
      expect(a[0].title).toContain("75%");
      const flat = snap({ txs: [tx({ kind: "income", amount_minor: 20_000, occurred_on: "2026-09-25" }), tx({ kind: "income", amount_minor: 19_000, occurred_on: "2026-10-25" })] });
      expect(byRule(flat, "revenue_drop")).toEqual([]);
    });
  });

  it("task_overdue: open tasks past due; severity follows priority", () => {
    const s = snap({
      tasks: [
        { id: "t1", title: "Fix login", status: "todo", priority: "high", due_on: "2026-11-01", project_id: null },
        { id: "t2", title: "Docs", status: "in_progress", priority: "low", due_on: "2026-11-06", project_id: null },
        { id: "t3", title: "Done", status: "done", priority: "high", due_on: "2026-11-01", project_id: null },
        { id: "t4", title: "Today", status: "todo", priority: "high", due_on: TODAY, project_id: null },
        { id: "t5", title: "No date", status: "todo", priority: "high", due_on: null, project_id: null },
      ],
    });
    const a = byRule(s, "task_overdue");
    expect(a.map((x) => [x.fingerprint, x.severity])).toEqual([
      ["task_overdue:t1:2026-11-01", "warning"],
      ["task_overdue:t2:2026-11-06", "info"],
    ]);
  });

  it("renewal_soon: active recurring costs due within N days", () => {
    const r = (id: string, next: string | null, active = true) => ({ id, name: id, next_due_on: next, amount_minor: 2_000, currency: "USD", active, project_id: null });
    const s = snap({ recurring: [r("soon", "2026-11-10"), r("today", TODAY), r("far", "2026-12-10"), r("inactive", "2026-11-09", false), r("past", "2026-11-01")] });
    expect(byRule(s, "renewal_soon").map((a) => a.fingerprint)).toEqual(["renewal_soon:soon:2026-11-10", "renewal_soon:today:2026-11-07"]);
  });

  it("integration_error: enabled integrations in error or stale", () => {
    const i = (p: Partial<AlertSnapshot["integrations"][number]>) => ({ id: "github", name: "GitHub", enabled: true, status: "connected", last_success_at: "2026-11-07T08:00:00Z", last_error: null, ...p });
    const err = byRule(snap({ integrations: [i({ status: "error", last_error: "HTTP 401: Bad credentials" })] }), "integration_error");
    expect(err).toHaveLength(1);
    expect(err[0]).toMatchObject({ severity: "warning", detail: "HTTP 401: Bad credentials" });
    expect(byRule(snap({ integrations: [i({ status: "error", enabled: false })] }), "integration_error")).toEqual([]);
    expect(byRule(snap({ integrations: [i({})] }), "integration_error")).toEqual([]);
    const stale = byRule(snap({ integrations: [i({ last_success_at: "2026-11-01T08:00:00Z" })] }), "integration_error");
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ severity: "info", fingerprint: "integration_stale:github:2026-11-01" });
  });

  it("launch_soon: upcoming or overdue launch dates of unlaunched projects", () => {
    const p = (id: string, status: string, target: string | null) => ({ id, name: id, status, last_activity_at: null, target_launch_on: target });
    const s = snap({ projects: [p("soon", "beta", "2026-11-12"), p("late", "development", "2026-11-01"), p("live", "launched", "2026-11-10"), p("far", "beta", "2027-01-01"), p("none", "beta", null)] });
    const a = byRule(s, "launch_soon");
    expect(a.map((x) => [x.project_id, x.severity])).toEqual([
      ["soon", "info"],
      ["late", "warning"],
    ]);
  });

  it("budget_overrun: month spend (expenses + fees + investment) vs budget", () => {
    const s = snap({
      budgets: [
        { project_id: null, month: "2026-11", currency: "USD", amount_minor: 10_000 },
        { project_id: "p2", month: "2026-11", currency: "USD", amount_minor: 50_000 },
        { project_id: null, month: "2026-10", currency: "USD", amount_minor: 1 },
      ],
      txs: [
        tx({ kind: "expense", amount_minor: 8_000, occurred_on: "2026-11-02", project_id: "p1" }),
        tx({ kind: "investment", amount_minor: 4_000, occurred_on: "2026-11-03", project_id: "p2" }),
        tx({ kind: "expense", amount_minor: 99_000, occurred_on: "2026-10-03" }),
      ],
    });
    const a = byRule(s, "budget_overrun");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ fingerprint: "budget_overrun:global:2026-11:USD", evidence: { spent_minor: 12_000, budget_minor: 10_000 } });
  });

  it("health_down: N consecutive failures", () => {
    const h = (recent: boolean[]) => ({ check_id: "h1", name: "API", project_id: null, recent: recent.map((ok, i) => ({ ok, checked_at: `2026-11-07T10:${String(59 - i).padStart(2, "0")}:00Z`, status_code: ok ? 200 : 503, error: null })) });
    const a = byRule(snap({ health: [h([false, false, true])] }), "health_down");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ severity: "critical", fingerprint: "health_down:h1:2026-11-07T10:57:00Z" });
    expect(byRule(snap({ health: [h([false, true, false])] }), "health_down")).toEqual([]);
    expect(byRule(snap({ health: [h([false])] }), "health_down")).toEqual([]);
  });

  it("health_down: one fingerprint per outage, stable while it stays down", () => {
    const res = (min: number, ok: boolean) => ({ ok, checked_at: `2026-11-07T10:${String(min).padStart(2, "0")}:00Z`, status_code: ok ? 200 : 503, error: null });
    const check = (recent: ReturnType<typeof res>[], last_ok_at?: string | null) => ({ check_id: "h1", name: "API", project_id: null, recent, ...(last_ok_at !== undefined ? { last_ok_at } : {}) });
    const fp = (c: ReturnType<typeof check>) => byRule(snap({ health: [c] }), "health_down").map((x) => x.fingerprint);
    const t1 = fp(check([res(30, false), res(15, false), res(0, true)]));
    const t2 = fp(check([res(45, false), res(30, false), res(15, false), res(0, true)]));
    expect(t1).toEqual(t2);
    // outage longer than the recent window: the snapshot's last_ok_at keeps it stable
    expect(fp(check([res(59, false), res(58, false)], "2026-11-07T10:00:00Z"))).toEqual(t1);
    expect(fp(check([res(59, false), res(58, false)], null))).toEqual(["health_down:h1:never"]);
    // a new outage after a recovery is a different alert
    const t3 = fp(check([res(59, false), res(55, false), res(50, true), res(45, false)]));
    expect(t3).not.toEqual(t1);
  });

  it("disabled rules produce nothing; params override defaults", () => {
    const s = snap({ tasks: [{ id: "t1", title: "x", status: "todo", priority: "low", due_on: "2026-11-01", project_id: null }], projects: [{ id: "p", name: "P", status: "beta", last_activity_at: "2026-11-01T00:00:00Z", target_launch_on: null }] });
    expect(byRule(s, "task_overdue", { task_overdue: { enabled: false, params: {} } })).toEqual([]);
    expect(byRule(s, "project_inactive")).toEqual([]);
    expect(byRule(s, "project_inactive", { project_inactive: { enabled: true, params: { days: 5 } } })).toHaveLength(1);
  });

  it("fingerprints are stable across evaluations and unique", () => {
    const s = snap({
      tasks: [{ id: "t1", title: "x", status: "todo", priority: "high", due_on: "2026-11-01", project_id: null }],
      deployments: [deploy({ external_id: "e", status: "error" })],
      recurring: [{ id: "r", name: "r", next_due_on: "2026-11-09", amount_minor: 1, currency: "USD", active: true, project_id: null }],
    });
    const a = evaluateRules(s, {}).map((x) => x.fingerprint);
    const b = evaluateRules(structuredClone(s), {}).map((x) => x.fingerprint);
    expect(a).toEqual(b);
    expect(a.length).toBe(3);
    expect(new Set(a).size).toBe(a.length);
  });

  it("every rule declares defaults for its params", () => {
    for (const r of RULES) for (const p of r.params) expect(typeof p.default).toBe("number");
  });
});

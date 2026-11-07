import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, scoreTask, type PriorityWeights, type ScorableTask } from "@/domain/priorities";

const TODAY = "2026-11-07";
const task = (p: Partial<ScorableTask> & { id: string }): ScorableTask => ({ status: "todo", priority: "medium", due_on: null, impact: null, effort: null, risk: null, depends_on: [], project_id: null, ...p });
const ctx = (tasks: ScorableTask[], launchDates: Record<string, string | null> = {}) => ({ today: TODAY, tasks, launchDates });
const factor = (r: ReturnType<typeof scoreTask>, key: string) => r.factors.find((f) => f.key === key)!;

describe("scoreTask", () => {
  it("exposes every factor with its weight", () => {
    const t = task({ id: "a" });
    const r = scoreTask(t, ctx([t]));
    expect(r.factors.map((f) => f.key).sort()).toEqual(Object.keys(DEFAULT_WEIGHTS).sort());
    for (const f of r.factors) {
      expect(f.weight).toBe(DEFAULT_WEIGHTS[f.key]);
      expect(f.value).toBeGreaterThanOrEqual(0);
      expect(f.value).toBeLessThanOrEqual(1);
    }
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("overdue tasks get urgency 1, due today ~1, far deadlines ~0", () => {
    const overdue = task({ id: "a", due_on: "2026-11-01" });
    const r = scoreTask(overdue, ctx([overdue]));
    expect(factor(r, "urgency").value).toBe(1);
    expect(factor(r, "urgency").note).toBe("Vencida hace 6 d");
    expect(factor(scoreTask(task({ id: "b", due_on: TODAY }), ctx([])), "urgency").value).toBe(1);
    expect(factor(scoreTask(task({ id: "c", due_on: "2026-12-31" }), ctx([])), "urgency").value).toBe(0);
    expect(factor(scoreTask(task({ id: "d" }), ctx([])), "urgency").value).toBe(0.15);
  });

  it("a task blocked by an open dependency is flagged and its score halved", () => {
    const dep = task({ id: "dep" });
    const t = task({ id: "t", depends_on: ["dep"], priority: "high", impact: 5 });
    const free = task({ id: "t", priority: "high", impact: 5 });
    const blocked = scoreTask(t, ctx([dep, t]));
    const unblocked = scoreTask(free, ctx([dep, free]));
    expect(blocked.blocked).toBe(true);
    expect(factor(blocked, "dependencies").value).toBe(0);
    // same factors except dependencies; halved afterwards
    const totalW = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    const raw = Math.round((blocked.factors.reduce((s, f) => s + f.value * f.weight, 0) / totalW) * 100);
    expect(blocked.score).toBe(Math.round(raw * 0.5));
    expect(blocked.score).toBeLessThan(unblocked.score / 2 + 1);
  });

  it("a completed dependency does not block", () => {
    const dep = task({ id: "dep", status: "done" });
    const t = task({ id: "t", depends_on: ["dep"] });
    expect(scoreTask(t, ctx([dep, t])).blocked).toBe(false);
  });

  it("unblocking other open tasks raises the score", () => {
    const t = task({ id: "t" });
    const lone = scoreTask(t, ctx([t]));
    const waiting = [task({ id: "w1", depends_on: ["t"] }), task({ id: "w2", depends_on: ["t"] })];
    const key = scoreTask(t, ctx([t, ...waiting]));
    expect(factor(key, "dependencies").value).toBe(1);
    expect(factor(key, "dependencies").note).toBe("Desbloquea 2 tarea(s)");
    expect(key.score).toBeGreaterThan(lone.score);
  });

  it("launch proximity of the task's project counts", () => {
    const t = task({ id: "t", project_id: "p" });
    const near = scoreTask(t, ctx([t], { p: "2026-11-17" }));
    const none = scoreTask(t, ctx([t], { p: null }));
    expect(factor(near, "launch").value).toBeCloseTo(1 - 10 / 60);
    expect(near.score).toBeGreaterThan(none.score);
  });

  it("weights change the ordering", () => {
    const urgent = task({ id: "u", due_on: "2026-11-05", impact: 1, effort: 5 });
    const impactful = task({ id: "i", due_on: null, impact: 5, effort: 1 });
    const all = [urgent, impactful];
    const urgencyHeavy: PriorityWeights = { ...DEFAULT_WEIGHTS, urgency: 10, impact: 0, effort: 0 };
    const impactHeavy: PriorityWeights = { ...DEFAULT_WEIGHTS, urgency: 0, impact: 10, effort: 3 };
    const rank = (w: PriorityWeights) => [...all].sort((a, b) => scoreTask(b, ctx(all), w).score - scoreTask(a, ctx(all), w).score).map((t) => t.id);
    expect(rank(urgencyHeavy)).toEqual(["u", "i"]);
    expect(rank(impactHeavy)).toEqual(["i", "u"]);
  });

  it("declared priority maps to a value", () => {
    const v = (priority: string) => factor(scoreTask(task({ id: "x", priority }), ctx([])), "declared").value;
    expect(v("urgent")).toBe(1);
    expect(v("high")).toBe(0.75);
    expect(v("low")).toBe(0.2);
    expect(v("weird")).toBe(0.5);
  });
});

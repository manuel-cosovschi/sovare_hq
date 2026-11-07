import { db } from "@/db";

export interface SearchHit {
  type: "project" | "task" | "transaction" | "campaign" | "event" | "repository";
  id: string;
  title: string;
  subtitle: string | null;
  route: string;
}

/** Global search across entities (LIKE-based; fast enough for a single-user local dataset). */
export async function globalSearch(q: string, limit = 8): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;
  const [projects, tasks, txs, campaigns, events, repos] = await Promise.all([
    db().select<{ id: string; name: string; status: string }>("SELECT id, name, status FROM projects WHERE name LIKE ? OR description LIKE ? OR category LIKE ? LIMIT ?", [like, like, like, limit]),
    db().select<{ id: string; title: string; status: string }>("SELECT id, title, status FROM tasks WHERE title LIKE ? OR description LIKE ? LIMIT ?", [like, like, limit]),
    db().select<{ id: string; description: string | null; occurred_on: string; currency: string; amount_minor: number; kind: string }>(
      "SELECT id, description, occurred_on, currency, amount_minor, kind FROM financial_transactions WHERE deleted_at IS NULL AND (description LIKE ? OR counterparty LIKE ? OR notes LIKE ?) ORDER BY occurred_on DESC LIMIT ?",
      [like, like, like, limit],
    ),
    db().select<{ id: string; name: string; platform: string }>("SELECT id, name, platform FROM campaigns WHERE name LIKE ? LIMIT ?", [like, limit]),
    db().select<{ id: string; title: string; occurred_at: string }>("SELECT id, title, occurred_at FROM activity_events WHERE title LIKE ? ORDER BY occurred_at DESC LIMIT ?", [like, limit]),
    db().select<{ id: string; full_name: string | null; canonical_key: string }>("SELECT id, full_name, canonical_key FROM repositories WHERE full_name LIKE ? OR canonical_key LIKE ? LIMIT ?", [like, like, limit]),
  ]);
  return [
    ...projects.map((p) => ({ type: "project" as const, id: p.id, title: p.name, subtitle: p.status, route: `/projects/${p.id}` })),
    ...tasks.map((t) => ({ type: "task" as const, id: t.id, title: t.title, subtitle: t.status, route: `/tasks?task=${t.id}` })),
    ...txs.map((t) => ({ type: "transaction" as const, id: t.id, title: t.description ?? t.kind, subtitle: `${t.occurred_on} · ${t.currency} ${(t.amount_minor / 100).toFixed(2)}`, route: `/finance?tx=${t.id}` })),
    ...campaigns.map((c) => ({ type: "campaign" as const, id: c.id, title: c.name, subtitle: c.platform, route: `/marketing?campaign=${c.id}` })),
    ...repos.map((r) => ({ type: "repository" as const, id: r.id, title: r.full_name ?? r.canonical_key, subtitle: "Repositorio", route: `/development?repo=${r.id}` })),
    ...events.map((e) => ({ type: "event" as const, id: e.id, title: e.title, subtitle: e.occurred_at.slice(0, 10), route: `/activity` })),
  ];
}

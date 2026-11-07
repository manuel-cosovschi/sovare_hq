import type { Db } from "./types";
import { migrations as all, type Migration } from "./migrations";

export interface MigrationReport {
  from: number;
  to: number;
  applied: string[];
}

/**
 * Applies pending migrations in order. Each migration runs inside its own transaction together
 * with the bookkeeping insert, so a failure leaves the database at the previous version.
 */
export async function migrate(db: Db, list: Migration[] = all): Promise<MigrationReport> {
  await db.script(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
  );
  const rows = await db.select<{ v: number | null }>("SELECT MAX(version) AS v FROM schema_migrations");
  const current = rows[0]?.v ?? 0;
  const sorted = [...list].sort((a, b) => a.version - b.version);
  const applied: string[] = [];
  for (const m of sorted) {
    if (m.version <= current) continue;
    const now = new Date().toISOString();
    const safeName = m.name.replace(/'/g, "''");
    await db.script(
      `BEGIN;\n${m.sql}\nINSERT INTO schema_migrations (version, name, applied_at) VALUES (${m.version}, '${safeName}', '${now}');\nCOMMIT;`,
    ).catch(async (e) => {
      await db.script("ROLLBACK;").catch(() => undefined);
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${(e as Error).message}`);
    });
    applied.push(`${m.version}_${m.name}`);
  }
  return { from: current, to: sorted.length ? Math.max(current, sorted[sorted.length - 1].version) : current, applied };
}

import type { Database, SqlJsStatic } from "sql.js";
import type { Db, Row, SqlParam, Statement } from "./types";
import { normalizeParams } from "./types";

/**
 * SQLite compiled to WebAssembly. Used by the browser/PWA fallback and by the test-suite, so
 * the exact same SQL and migrations run everywhere.
 */
export function wrapSqlJs(db: Database, onWrite?: () => void, kind: Db["kind"] = "memory"): Db {
  db.run("PRAGMA foreign_keys = ON;");
  const select = async <T = Row>(sql: string, params?: SqlParam[]): Promise<T[]> => {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(normalizeParams(params));
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  };
  return {
    kind,
    select,
    execute: async (sql, params) => {
      db.run(sql, normalizeParams(params));
      const changes = db.getRowsModified();
      const r = db.exec("SELECT last_insert_rowid() AS id");
      onWrite?.();
      return { changes, lastId: Number(r[0]?.values[0]?.[0] ?? 0) };
    },
    batch: async (statements: Statement[]) => {
      let total = 0;
      db.run("BEGIN");
      try {
        for (const s of statements) {
          db.run(s.sql, normalizeParams(s.params));
          total += db.getRowsModified();
        }
        db.run("COMMIT");
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
      onWrite?.();
      return total;
    },
    script: async (sql) => {
      db.exec(sql);
      onWrite?.();
    },
  };
}

export async function createMemoryDb(SQL: SqlJsStatic): Promise<Db> {
  return wrapSqlJs(new SQL.Database(), undefined, "memory");
}

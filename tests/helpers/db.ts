import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { wrapSqlJs } from "@/db/sqljsDb";
import { installDb, type Profile } from "@/db";
import type { Db } from "@/db/types";

let sqlPromise: Promise<SqlJsStatic> | null = null;

/** sql.js finds its wasm next to its own module in node. Cached across tests in one file. */
export function getSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs();
  return sqlPromise;
}

export interface TestDb {
  SQL: SqlJsStatic;
  raw: Database;
  db: Db;
}

/** Fresh in-memory database with all migrations applied, registered as the active database. */
export async function freshDb(profile: Profile = "main"): Promise<TestDb> {
  const SQL = await getSql();
  const raw = new SQL.Database();
  const db = wrapSqlJs(raw);
  await installDb(db, profile);
  return { SQL, raw, db };
}

/** Reopens a database from exported bytes (simulates closing and reopening the app). */
export async function reopen(SQL: SqlJsStatic, bytes: Uint8Array, profile: Profile = "main"): Promise<TestDb> {
  const raw = new SQL.Database(bytes);
  const db = wrapSqlJs(raw);
  await installDb(db, profile);
  return { SQL, raw, db };
}

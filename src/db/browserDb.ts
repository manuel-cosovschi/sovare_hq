import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { wrapSqlJs } from "./sqljsDb";
import type { Db } from "./types";
import { idbGet, idbSet } from "@/platform/idb";

/** Browser/PWA fallback: SQLite (WASM) persisted to IndexedDB, one database per profile. */
export type BrowserDb = Db & { path: string; exportBytes: () => Uint8Array; importBytes: (b: Uint8Array) => Promise<void>; flush: () => Promise<void> };

const open = new Map<string, Promise<BrowserDb>>();

/** One live instance per profile; pending writes are flushed before switching away. */
export function openBrowserDb(profile: "main" | "demo"): Promise<BrowserDb> {
  if (!open.has(profile)) open.set(profile, create(profile));
  return open.get(profile)!;
}

export async function flushAll() {
  for (const p of open.values()) await (await p).flush();
}

async function create(profile: "main" | "demo"): Promise<BrowserDb> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const key = `db:${profile}`;
  const saved = await idbGet<Uint8Array>(key);
  let raw = saved ? new SQL.Database(saved) : new SQL.Database();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  const persist = async () => {
    dirty = false;
    await idbSet(key, raw.export());
  };
  const schedule = () => {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => void persist(), 250);
  };
  window.addEventListener("pagehide", () => void persist());
  let wrapped = wrapSqlJs(raw, schedule, "browser");
  const proxy: Db = {
    kind: "browser",
    select: (s, p) => wrapped.select(s, p),
    execute: (s, p) => wrapped.execute(s, p),
    batch: (s) => wrapped.batch(s),
    script: (s) => wrapped.script(s),
  };
  return {
    ...proxy,
    path: `IndexedDB · ${key}`,
    flush: async () => {
      clearTimeout(timer);
      if (dirty) await persist();
    },
    exportBytes: () => raw.export(),
    importBytes: async (bytes: Uint8Array) => {
      const candidate = new SQL.Database(bytes);
      const ok = candidate.exec("PRAGMA integrity_check")[0]?.values[0]?.[0];
      const hasMig = candidate.exec("SELECT count(*) FROM sqlite_master WHERE name='schema_migrations'")[0]?.values[0]?.[0];
      if (ok !== "ok" || !hasMig) throw new Error("El archivo no es un backup válido de Sovare HQ");
      await idbSet(`${key}:pre-restore`, raw.export());
      raw = candidate;
      wrapped = wrapSqlJs(raw, schedule, "browser");
      await persist();
    },
  };
}

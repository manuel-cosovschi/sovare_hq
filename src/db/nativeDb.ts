import type { Db, Row, SqlParam, Statement } from "./types";
import { normalizeParams } from "./types";
import { call } from "@/platform/native";

export async function openNativeDb(profile: "main" | "demo"): Promise<Db & { path: string }> {
  const path = await call<string>("db_open", { profile });
  return {
    kind: "native",
    path,
    select: <T = Row>(sql: string, params?: SqlParam[]) => call<T[]>("db_select", { sql, params: normalizeParams(params) }),
    execute: async (sql: string, params?: SqlParam[]) => {
      const r = await call<{ changes: number; last_id: number }>("db_execute", { sql, params: normalizeParams(params) });
      return { changes: r.changes, lastId: r.last_id };
    },
    batch: (statements: Statement[]) =>
      call<number>("db_batch", { statements: statements.map((s) => ({ sql: s.sql, params: normalizeParams(s.params) })) }),
    script: (sql: string) => call<void>("db_exec_script", { sql }),
  };
}

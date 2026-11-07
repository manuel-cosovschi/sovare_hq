export type SqlValue = string | number | null;
export type SqlParam = SqlValue | boolean | undefined;
export type Row = Record<string, SqlValue>;

export interface Statement {
  sql: string;
  params?: SqlParam[];
}

export interface Db {
  readonly kind: "native" | "browser" | "memory";
  select<T = Row>(sql: string, params?: SqlParam[]): Promise<T[]>;
  execute(sql: string, params?: SqlParam[]): Promise<{ changes: number; lastId: number }>;
  /** Executes all statements atomically. */
  batch(statements: Statement[]): Promise<number>;
  /** Executes a multi-statement script (migrations). */
  script(sql: string): Promise<void>;
}

export function normalizeParams(params: SqlParam[] = []): SqlValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));
}

import type { SecretKey } from "@/platform/secrets";

export type ConnectorCategory = "development" | "finance" | "marketing" | "analytics" | "hosting" | "ai" | "data";
export type Availability = "available" | "limited" | "planned";

export interface ConfigField {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  type?: "text" | "project" | "select";
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
}

export interface SyncContext {
  config: Record<string, string>;
  cursor: string | null;
  projectFor: (externalRef: string) => string | null;
  log: (msg: string) => void;
}

export interface SyncOutcome {
  fetched: number;
  upserted: number;
  cursor?: string | null;
  accountLabel?: string | null;
  details?: string;
  warnings?: string[];
}

export interface TestOutcome {
  ok: boolean;
  message: string;
  accountLabel?: string;
}

export interface ExternalResource {
  ref: string;
  label: string;
  hint?: string;
}

export interface ConnectorDef {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  availability: Availability;
  auth: "token" | "oauth_token" | "none" | "folder" | "file";
  secretKey?: SecretKey;
  secretLabel?: string;
  permissions: string[];
  setup: string[];
  docsUrl?: string;
  limitations: string[];
  incremental: boolean;
  configFields: ConfigField[];
  /** For connectors without credentials: whether the user has configured them. */
  isConfigured?: () => Promise<boolean>;
  test?: (ctx: SyncContext) => Promise<TestOutcome>;
  sync?: (ctx: SyncContext) => Promise<SyncOutcome>;
  listExternal?: (ctx: SyncContext) => Promise<ExternalResource[]>;
  /** Default auto-sync interval (minutes) while the app is open. */
  syncEveryMinutes?: number;
}

import type { Currency } from "./money";

export const PROJECT_STATUSES = [
  "idea", "research", "design", "planning", "development", "testing", "beta",
  "launched", "production", "maintenance", "paused", "archived",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  idea: "Idea", research: "Research", design: "Design", planning: "Planning",
  development: "Development", testing: "Testing", beta: "Beta", launched: "Launched",
  production: "Production", maintenance: "Maintenance", paused: "Paused", archived: "Archived",
};

/** Statuses considered "active" (work or operation ongoing). */
export const ACTIVE_STATUSES: ProjectStatus[] = ["research", "design", "planning", "development", "testing", "beta", "launched", "production", "maintenance"];
export const LIVE_STATUSES: ProjectStatus[] = ["launched", "production", "maintenance"];

export const PROJECT_TYPES = ["saas", "web", "mobile", "desktop", "ecommerce", "marketplace", "bot", "api", "brand", "other"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];
export const TYPE_LABEL: Record<ProjectType, string> = {
  saas: "SaaS", web: "Web app", mobile: "App móvil", desktop: "Desktop", ecommerce: "E-commerce",
  marketplace: "Marketplace", bot: "Bot / Automatización", api: "API / Backend", brand: "Marca / Organización", other: "Otro",
};

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };

export interface Scorecard {
  market_potential?: number;
  strategic_fit?: number;
  technical_readiness?: number;
  effort_to_launch?: number;
  notes?: string;
}

export interface Project {
  id: string;
  organization_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  logo_data: string | null;
  type: ProjectType;
  category: string | null;
  status: ProjectStatus;
  priority: Priority;
  is_candidate: boolean;
  target_launch_on: string | null;
  monetization_model: string | null;
  pricing_notes: string | null;
  languages: string[];
  frameworks: string[];
  database_tech: string | null;
  architecture: string | null;
  hosting: string | null;
  environments: string[];
  dependencies: string[];
  domain: string | null;
  local_path: string | null;
  docs_url: string | null;
  notes: string | null;
  scorecard: Scorecard;
  source: string;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export const LINK_KINDS = ["repo", "production", "staging", "docs", "admin", "provider", "design", "analytics", "other"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const LINK_LABEL: Record<LinkKind, string> = {
  repo: "Repositorio", production: "Producción", staging: "Staging", docs: "Documentación", admin: "Admin panel",
  provider: "Panel del proveedor", design: "Diseño", analytics: "Analytics", other: "Otro",
};

export interface ProjectLink {
  id: string;
  project_id: string;
  kind: LinkKind;
  label: string | null;
  url: string;
  created_at: string;
}

export interface Repository {
  id: string;
  project_id: string | null;
  canonical_key: string;
  provider: string;
  full_name: string | null;
  html_url: string | null;
  local_path: string | null;
  default_branch: string | null;
  description: string | null;
  primary_language: string | null;
  is_private: number | null;
  is_archived: number | null;
  open_issues: number | null;
  open_prs: number | null;
  stars: number | null;
  last_commit_at: string | null;
  last_commit_sha: string | null;
  last_commit_message: string | null;
  pushed_at: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TxKind = "income" | "expense" | "refund" | "fee" | "investment";
export const TX_KIND_LABEL: Record<TxKind, string> = {
  income: "Ingreso", expense: "Gasto", refund: "Reembolso", fee: "Comisión", investment: "Inversión",
};

export interface Transaction {
  id: string;
  project_id: string | null;
  kind: TxKind;
  category: string;
  description: string | null;
  counterparty: string | null;
  amount_minor: number;
  currency: Currency;
  occurred_on: string;
  status: "cleared" | "pending";
  source: string;
  external_id: string | null;
  import_batch_id: string | null;
  recurring_cost_id: string | null;
  attachment: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type RecurringInterval = "weekly" | "monthly" | "quarterly" | "yearly";
export interface RecurringCost {
  id: string;
  project_id: string | null;
  name: string;
  vendor: string | null;
  category: string;
  amount_minor: number;
  currency: Currency;
  interval: RecurringInterval;
  next_due_on: string | null;
  active: boolean;
  url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExchangeRate {
  id: string;
  base: Currency;
  quote: Currency;
  rate: number;
  as_of: string;
  source: string;
  created_at: string;
}

export interface Budget {
  id: string;
  project_id: string | null;
  month: string;
  currency: Currency;
  amount_minor: number;
}

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "canceled";
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "Por hacer", in_progress: "En curso", blocked: "Bloqueada", done: "Hecha", canceled: "Cancelada",
};
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };

export interface Task {
  id: string;
  project_id: string | null;
  milestone_id: string | null;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_on: string | null;
  completed_at: string | null;
  labels: string[];
  impact: number | null;
  effort: number | null;
  risk: number | null;
  depends_on: string[];
  external_source: string | null;
  external_ref: string | null;
  external_url: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  due_on: string | null;
  status: "planned" | "active" | "done" | "canceled";
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ActivityEvent {
  id: string;
  occurred_at: string;
  project_id: string | null;
  source: string;
  type: string;
  title: string;
  detail: string | null;
  external_id: string | null;
  url: string | null;
  created_at: string;
}

export type Severity = "info" | "warning" | "critical";
export interface Alert {
  id: string;
  rule_id: string;
  fingerprint: string;
  project_id: string | null;
  severity: Severity;
  title: string;
  detail: string | null;
  evidence: Record<string, unknown>;
  link: string | null;
  status: "open" | "dismissed" | "resolved";
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  notified_at: string | null;
}

export interface Campaign {
  id: string;
  platform: string;
  account_id: string | null;
  external_id: string;
  level: "campaign" | "adset" | "ad";
  parent_external_id: string | null;
  project_id: string | null;
  name: string;
  objective: string | null;
  status: string;
  daily_budget_minor: number | null;
  lifetime_budget_minor: number | null;
  currency: string | null;
  start_on: string | null;
  end_on: string | null;
  source: string;
  synced_at: string | null;
}

export interface AdMetricRow {
  id: string;
  campaign_id: string;
  date: string;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  spend_minor: number | null;
  currency: string | null;
  conversions: number | null;
  conversion_value_minor: number | null;
  conversion_label: string | null;
  source: string;
}

export interface Deployment {
  id: string;
  project_id: string | null;
  provider: string;
  external_id: string;
  provider_project: string | null;
  environment: string | null;
  status: "queued" | "building" | "ready" | "error" | "canceled" | "unknown";
  url: string | null;
  inspect_url: string | null;
  commit_sha: string | null;
  commit_message: string | null;
  branch: string | null;
  created_at_ext: string;
  finished_at_ext: string | null;
}

export interface HealthCheck {
  id: string;
  project_id: string | null;
  name: string;
  url: string;
  method: "GET" | "HEAD";
  expected_status: number;
  timeout_ms: number;
  interval_minutes: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface HealthResult {
  id: string;
  check_id: string;
  checked_at: string;
  ok: boolean;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
}

export interface DevItem {
  id: string;
  repository_id: string | null;
  project_id: string | null;
  kind: "commit" | "issue" | "pull_request" | "release" | "workflow_run";
  external_id: string;
  number: number | null;
  title: string;
  state: string | null;
  author: string | null;
  url: string | null;
  created_at_ext: string;
  updated_at_ext: string | null;
  closed_at_ext: string | null;
  extra: Record<string, unknown>;
}

export interface MetricObservation {
  id: string;
  project_id: string | null;
  metric_key: string;
  value: number;
  unit: string;
  currency: string | null;
  period_start: string;
  period_end: string;
  source: string;
  source_ref: string | null;
  is_manual: boolean;
  recorded_at: string;
}

export type IntegrationStatus = "connected" | "disconnected" | "needs_setup" | "syncing" | "error" | "unsupported";
export interface IntegrationRow {
  id: string;
  enabled: boolean;
  status: IntegrationStatus;
  config: Record<string, string>;
  account_label: string | null;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  retry_count: number;
  sync_cursor: string | null;
}

export interface SyncRun {
  id: string;
  integration_id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "error" | "partial";
  items_fetched: number;
  items_upserted: number;
  error: string | null;
  details: string | null;
}

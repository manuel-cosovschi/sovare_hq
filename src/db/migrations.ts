/**
 * Versioned, append-only migrations. NEVER edit a migration that has shipped: add a new one.
 * Conventions: TEXT UUID primary keys, ISO-8601 UTC timestamps (`*_at`), dates as YYYY-MM-DD
 * (`*_on`), money as integer minor units + ISO currency, JSON arrays/objects stored as TEXT.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: /* sql */ `
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  color TEXT,
  logo_data TEXT,
  type TEXT NOT NULL DEFAULT 'other',
  category TEXT,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','research','design','planning','development','testing','beta','launched','production','maintenance','paused','archived')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  is_candidate INTEGER NOT NULL DEFAULT 0,
  target_launch_on TEXT,
  monetization_model TEXT,
  pricing_notes TEXT,
  languages TEXT NOT NULL DEFAULT '[]',
  frameworks TEXT NOT NULL DEFAULT '[]',
  database_tech TEXT,
  architecture TEXT,
  hosting TEXT,
  environments TEXT NOT NULL DEFAULT '[]',
  dependencies TEXT NOT NULL DEFAULT '[]',
  domain TEXT,
  local_path TEXT,
  docs_url TEXT,
  notes TEXT,
  scorecard TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'manual',
  last_activity_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_projects_status ON projects(status);

CREATE TABLE project_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_links_project ON project_links(project_id);

CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  canonical_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  full_name TEXT,
  html_url TEXT,
  local_path TEXT,
  default_branch TEXT,
  description TEXT,
  primary_language TEXT,
  is_private INTEGER,
  is_archived INTEGER,
  open_issues INTEGER,
  open_prs INTEGER,
  stars INTEGER,
  last_commit_at TEXT,
  last_commit_sha TEXT,
  last_commit_message TEXT,
  pushed_at TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_repos_project ON repositories(project_id);

CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'needs_setup' CHECK (status IN ('connected','disconnected','needs_setup','syncing','error','unsupported')),
  config TEXT NOT NULL DEFAULT '{}',
  account_label TEXT,
  last_sync_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  sync_cursor TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE integration_mappings (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  external_ref TEXT NOT NULL,
  external_label TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (integration_id, external_ref)
);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','success','error','partial')),
  items_fetched INTEGER NOT NULL DEFAULT 0,
  items_upserted INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  details TEXT
);
CREATE INDEX idx_sync_runs ON sync_runs(integration_id, started_at DESC);

CREATE TABLE exchange_rates (
  id TEXT PRIMARY KEY,
  base TEXT NOT NULL CHECK (length(base) = 3),
  quote TEXT NOT NULL CHECK (length(quote) = 3),
  rate REAL NOT NULL CHECK (rate > 0),
  as_of TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (base, quote, as_of, source)
);

CREATE TABLE recurring_costs (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  vendor TEXT,
  category TEXT NOT NULL DEFAULT 'tools',
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  interval TEXT NOT NULL CHECK (interval IN ('weekly','monthly','quarterly','yearly')),
  next_due_on TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE financial_transactions (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense','refund','fee','investment')),
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT,
  counterparty TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  occurred_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'cleared' CHECK (status IN ('cleared','pending')),
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  import_batch_id TEXT,
  recurring_cost_id TEXT REFERENCES recurring_costs(id) ON DELETE SET NULL,
  attachment TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX ux_tx_external ON financial_transactions(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_tx_date ON financial_transactions(occurred_on);
CREATE INDEX idx_tx_project ON financial_transactions(project_id, occurred_on);

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_budget ON budgets(COALESCE(project_id, ''), month, currency);

CREATE TABLE metric_observations (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  currency TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT,
  is_manual INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_metric ON metric_observations(COALESCE(project_id, ''), metric_key, period_start, period_end, source);
CREATE INDEX idx_metric_key ON metric_observations(metric_key, period_end);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  account_id TEXT,
  external_id TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'campaign' CHECK (level IN ('campaign','adset','ad')),
  parent_external_id TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  objective TEXT,
  status TEXT NOT NULL,
  daily_budget_minor INTEGER,
  lifetime_budget_minor INTEGER,
  currency TEXT,
  start_on TEXT,
  end_on TEXT,
  source TEXT NOT NULL,
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (platform, external_id)
);

CREATE TABLE ad_metrics (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  impressions INTEGER,
  reach INTEGER,
  clicks INTEGER,
  spend_minor INTEGER,
  currency TEXT,
  conversions REAL,
  conversion_value_minor INTEGER,
  conversion_label TEXT,
  source TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  UNIQUE (campaign_id, date)
);

CREATE TABLE dev_items (
  id TEXT PRIMARY KEY,
  repository_id TEXT REFERENCES repositories(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('commit','issue','pull_request','release','workflow_run')),
  external_id TEXT NOT NULL,
  number INTEGER,
  title TEXT NOT NULL,
  state TEXT,
  author TEXT,
  url TEXT,
  created_at_ext TEXT NOT NULL,
  updated_at_ext TEXT,
  closed_at_ext TEXT,
  extra TEXT NOT NULL DEFAULT '{}',
  synced_at TEXT NOT NULL,
  UNIQUE (kind, external_id)
);
CREATE INDEX idx_dev_items_project ON dev_items(project_id, created_at_ext DESC);

CREATE TABLE deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  provider_project TEXT,
  environment TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','building','ready','error','canceled','unknown')),
  url TEXT,
  inspect_url TEXT,
  commit_sha TEXT,
  commit_message TEXT,
  branch TEXT,
  created_at_ext TEXT NOT NULL,
  finished_at_ext TEXT,
  synced_at TEXT NOT NULL,
  UNIQUE (provider, external_id)
);
CREATE INDEX idx_deploy_project ON deployments(project_id, created_at_ext DESC);

CREATE TABLE health_checks (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET' CHECK (method IN ('GET','HEAD')),
  expected_status INTEGER NOT NULL DEFAULT 200,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  interval_minutes INTEGER NOT NULL DEFAULT 15,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE health_results (
  id TEXT PRIMARY KEY,
  check_id TEXT NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  status_code INTEGER,
  latency_ms INTEGER,
  error TEXT
);
CREATE INDEX idx_health_results ON health_results(check_id, checked_at DESC);

CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_on TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','done','canceled')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','blocked','done','canceled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  due_on TEXT,
  completed_at TEXT,
  labels TEXT NOT NULL DEFAULT '[]',
  impact INTEGER CHECK (impact BETWEEN 1 AND 5),
  effort INTEGER CHECK (effort BETWEEN 1 AND 5),
  risk INTEGER CHECK (risk BETWEEN 1 AND 5),
  depends_on TEXT NOT NULL DEFAULT '[]',
  external_source TEXT,
  external_ref TEXT,
  external_url TEXT,
  sort_order REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_task_external ON tasks(external_source, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX idx_tasks_project ON tasks(project_id, status);
CREATE INDEX idx_tasks_due ON tasks(due_on);

CREATE TABLE activity_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  external_id TEXT,
  url TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_activity_external ON activity_events(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_activity_time ON activity_events(occurred_at DESC);

CREATE TABLE alert_rules (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  notify INTEGER NOT NULL DEFAULT 1,
  params TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  title TEXT NOT NULL,
  detail TEXT,
  evidence TEXT NOT NULL DEFAULT '{}',
  link TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','resolved')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT,
  notified_at TEXT
);
CREATE INDEX idx_alerts_status ON alerts(status, severity);

CREATE TABLE ai_insights (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ai_insights ON ai_insights(kind, created_at DESC);

CREATE TABLE ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ai_messages ON ai_messages(conversation_id, created_at);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','delete','restore')),
  before TEXT,
  after TEXT,
  at TEXT NOT NULL
);
CREATE INDEX idx_audit ON audit_log(entity, entity_id, at);

CREATE TABLE user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
];

-- 0.5 app migration 0019: the automation store — immutable versions, project
-- bindings, one live deployment per name, triggers, durable runs (checkpoint
-- + liveness/fence columns), ask_human rows, deletion tombstones, and the
-- upload-intent ownership records.

-- Immutable version history: one row per (org, name, version).
CREATE TABLE app.automations (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  -- Automation slug — a '/'-separated path, unique per organization.
  name text NOT NULL,
  -- 1-based, contiguous per (org, name).
  version int NOT NULL,
  -- The v1 automation document as authored (validated by the engine).
  document jsonb NOT NULL,
  message text,
  tests_passed boolean,
  task_contract jsonb,
  settings jsonb,
  presentation jsonb,
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  UNIQUE (org_id, name, version)
);

CREATE INDEX automations_org_name ON app.automations (org_id, name);

-- Binding SET = scope: no rows → org-level; rows → exactly those projects.
CREATE TABLE app.automation_project_bindings (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  automation_name text NOT NULL,
  project_id text NOT NULL REFERENCES app.projects (id),
  bound_at_ms bigint NOT NULL,
  bound_by text NOT NULL,
  UNIQUE (org_id, automation_name, project_id)
);

CREATE INDEX automation_bindings_project
  ON app.automation_project_bindings (project_id);

-- The one live-eligible version per automation.
CREATE TABLE app.automation_deployments (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  name text NOT NULL,
  version int NOT NULL,
  deployed_by text NOT NULL,
  deployed_at_ms bigint NOT NULL,
  UNIQUE (org_id, name)
);

-- What starts a run; bound to the NAME so redeploys never invalidate a
-- webhook URL or a schedule.
CREATE TABLE app.automation_triggers (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('schedule', 'webhook', 'event')),
  cron text,
  timezone text,
  -- Hashed webhook token (plaintext shown once, never stored).
  token_hash text,
  event text,
  enabled boolean NOT NULL DEFAULT true,
  last_fired_at_ms bigint,
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE INDEX automation_triggers_org_name
  ON app.automation_triggers (org_id, name);
CREATE INDEX automation_triggers_kind
  ON app.automation_triggers (kind, enabled);
CREATE INDEX automation_triggers_token
  ON app.automation_triggers (token_hash);

-- Single-use ownership record for an uploaded package blob.
CREATE TABLE app.automation_upload_intents (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_ref text NOT NULL UNIQUE,
  org_id text NOT NULL,
  user_id text NOT NULL,
  created_at_ms bigint NOT NULL
);

-- One execution. Checkpoints make the run durable; wakeAt is the liveness
-- promise; claimEpoch fences stale walkers; chainSeq fences poll chains.
CREATE TABLE app.automation_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  name text NOT NULL,
  version int NOT NULL,
  project_id text,
  status text NOT NULL CHECK (status IN (
    'queued', 'running', 'waiting', 'success', 'failed', 'cancelled'
  )),
  mode text NOT NULL CHECK (mode IN ('mock', 'live')),
  started_by text NOT NULL,
  input jsonb,
  output jsonb,
  -- {nodes: {<nodeId>: checkpoint}, cursor?, executions}
  checkpoints jsonb,
  trace jsonb,
  effects jsonb,
  detail text,
  wake_at_ms bigint,
  claim_epoch int NOT NULL DEFAULT 0,
  claimed_at_ms bigint,
  chain_seq int NOT NULL DEFAULT 0,
  lifecycle_status text,
  status_changed_at_ms bigint,
  started_at_ms bigint NOT NULL,
  finished_at_ms bigint
);

CREATE INDEX automation_runs_org_name
  ON app.automation_runs (org_id, name, started_at_ms DESC);
CREATE INDEX automation_runs_org_project
  ON app.automation_runs (org_id, project_id, started_at_ms DESC);
CREATE INDEX automation_runs_status_wake
  ON app.automation_runs (status, wake_at_ms);
CREATE INDEX automation_runs_org_lifecycle
  ON app.automation_runs (org_id, lifecycle_status);

-- One ask_human question and its answer.
CREATE TABLE app.automation_human_asks (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  run_id text NOT NULL REFERENCES app.automation_runs (id) ON DELETE CASCADE,
  node_id text NOT NULL,
  session_id text NOT NULL,
  exec_id text NOT NULL,
  agent_session_id text,
  question text NOT NULL,
  questions jsonb,
  status text NOT NULL CHECK (status IN (
    'pending', 'answered', 'expired', 'cancelled'
  )),
  expires_at_ms bigint NOT NULL,
  answer text,
  answered_by text,
  answered_at_ms bigint,
  task_id text,
  created_at_ms bigint NOT NULL
);

CREATE INDEX automation_asks_run
  ON app.automation_human_asks (run_id, status);
CREATE INDEX automation_asks_session
  ON app.automation_human_asks (session_id, exec_id);
CREATE INDEX automation_asks_org ON app.automation_human_asks (org_id);

-- Deliberate deletions, remembered by name (the pack seeder skips them).
CREATE TABLE app.automation_tombstones (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  name text NOT NULL,
  deleted_by text NOT NULL,
  deleted_at_ms bigint NOT NULL,
  UNIQUE (org_id, name)
);

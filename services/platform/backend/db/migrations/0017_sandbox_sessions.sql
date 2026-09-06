-- 0.5 app migration 0017: the sandbox session substrate — sessions, scoped
-- gateway tokens (hash only), in-session op rows (live progress + the
-- durable-turn fields), workflow re-attach checkpoints, FIFO admission
-- tickets, and the credential-access audit trail.

CREATE TABLE app.sandbox_sessions (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  -- Spawner-side session id (container/Pod name seed). NOT unique: a healed
  -- phantom (row destroyed, deterministic id re-provisioned) creates a new
  -- incarnation under the same id — reads take the latest row.
  session_id text NOT NULL,
  profile jsonb,
  status text NOT NULL CHECK (status IN (
    'creating', 'active', 'degraded', 'stopped', 'destroyed', 'expired',
    'failed'
  )),
  -- Polymorphic owner (open string set: project_agent | workflow_run |
  -- render | legacy user/thread | ...).
  owner_type text NOT NULL,
  owner_id text NOT NULL,
  created_by text NOT NULL,
  agent_kind text,
  -- Gateway virtual-key id (never the plaintext key).
  llm_gateway_key_id text,
  pinned boolean NOT NULL DEFAULT false,
  pinned_at_ms bigint,
  created_at_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL,
  last_activity_at_ms bigint,
  destroyed_at_ms bigint
);

CREATE INDEX sandbox_sessions_org_status
  ON app.sandbox_sessions (org_id, status);
CREATE INDEX sandbox_sessions_owner
  ON app.sandbox_sessions (owner_type, owner_id);
CREATE INDEX sandbox_sessions_status ON app.sandbox_sessions (status);
CREATE INDEX sandbox_sessions_session_id
  ON app.sandbox_sessions (session_id, created_at_ms DESC);

CREATE TABLE app.sandbox_session_tokens (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  session_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  llm_gateway_key_id text,
  -- {agentKind, allowedModels, connectorGrants, budgetCents, toolGrants?,
  --  agentSlug?, threadId?, userId?}
  scope jsonb NOT NULL,
  created_at_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL,
  revoked_at_ms bigint
);

CREATE INDEX sandbox_session_tokens_session
  ON app.sandbox_session_tokens (session_id);
CREATE INDEX sandbox_session_tokens_org
  ON app.sandbox_session_tokens (org_id);

CREATE TABLE app.sandbox_session_ops (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  session_id text NOT NULL,
  thread_id text,
  exec_id text NOT NULL,
  kind text NOT NULL, -- 'task-agent' | 'workflow-agent' (SANDBOX_AGENT_OP_KINDS)
  status text NOT NULL CHECK (status IN (
    'running', 'completed', 'failed', 'cancelled'
  )),
  progress_text text,
  -- Live tool/reasoning transcript for workflow-run steps (AI-SDK UI parts).
  live_timeline jsonb,
  agent_session_id text,
  exit_code int,
  event_log_ref text,
  -- Durable-turn fields (connection-independent turns).
  assistant_message_id text,
  minted_key_id text,
  user_id text,
  model_ref text,
  vision_model_ref text,
  agent_slug text,
  stream_id text,
  deadline_ms bigint,
  heartbeat_at_ms bigint,
  last_event_at_ms bigint,
  agent_idle_at_ms bigint,
  pending_background_tasks int,
  last_seq bigint,
  checkpoint_ref text,
  finalized_at_ms bigint,
  continuation_count int,
  spent_cents double precision,
  paused_reason text,
  agent_result_status text,
  resumed_by text,
  started_at_ms bigint NOT NULL,
  finished_at_ms bigint,
  UNIQUE (session_id, exec_id)
);

CREATE INDEX sandbox_session_ops_session
  ON app.sandbox_session_ops (session_id);
CREATE INDEX sandbox_session_ops_thread ON app.sandbox_session_ops (thread_id);
CREATE INDEX sandbox_session_ops_org_status
  ON app.sandbox_session_ops (org_id, status);
CREATE INDEX sandbox_session_ops_status_heartbeat
  ON app.sandbox_session_ops (status, heartbeat_at_ms);
CREATE INDEX sandbox_session_ops_thread_kind_started
  ON app.sandbox_session_ops (thread_id, kind, started_at_ms DESC);

-- Workflow durable-step re-attach cursor: one row per session.
CREATE TABLE app.sandbox_agent_checkpoints (
  session_id text PRIMARY KEY,
  org_id text NOT NULL,
  exec_id text NOT NULL,
  last_seq bigint NOT NULL,
  agent_session_id text,
  agent_result_seen boolean,
  agent_idle boolean,
  pending_task_ids text[],
  api_error_seen boolean,
  task_run_id text,
  started_at_ms bigint NOT NULL,
  continuation_count int NOT NULL,
  updated_at_ms bigint NOT NULL
);

-- FIFO park-on-capacity tickets. A waiting ticket holds no compute; only the
-- session row it eventually inserts counts toward a cap. created_at_ms is the
-- FIFO key (set once, never re-stamped); last_seen_at_ms is the poll
-- heartbeat the reaper judges.
CREATE TABLE app.sandbox_admission_tickets (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('session')),
  owner_type text NOT NULL,
  owner_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('chat', 'workflow')),
  thread_id text,
  wf_execution_id text,
  step_slug text,
  status text NOT NULL CHECK (status IN ('waiting', 'admitted')),
  created_at_ms bigint NOT NULL,
  last_seen_at_ms bigint NOT NULL,
  UNIQUE (owner_type, owner_id)
);

CREATE INDEX sandbox_admission_fifo
  ON app.sandbox_admission_tickets (org_id, kind, status, created_at_ms);
CREATE INDEX sandbox_admission_status_seen
  ON app.sandbox_admission_tickets (status, last_seen_at_ms);

-- Tier-2 credential-fetch audit trail (bootstrap/git tokens into a session).
CREATE TABLE app.sandbox_credential_access (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id text NOT NULL,
  session_id text NOT NULL,
  slug text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bootstrap', 'git')),
  fetched_at_ms bigint NOT NULL
);

CREATE INDEX sandbox_credential_access_session
  ON app.sandbox_credential_access (session_id);
CREATE INDEX sandbox_credential_access_org
  ON app.sandbox_credential_access (org_id);

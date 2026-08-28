-- 0.5 app migration 0021: the project-agent run ledger — one row per run of
-- a project agent against a task (the task-side twin of an automation run).
-- Kicked by the status choreography, driven by the turn host, settled
-- exactly once; capacity parks stamp waiting_for_capacity_at_ms and the
-- release-edge wake claims it (clearing the stamp IS the single-winner
-- election).

CREATE TABLE app.project_agent_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monotonic creation order (the 0.4 _creationTime): newest-first walks
  -- (predecessor pick, retry budget) must never tie on a same-ms clock.
  seq bigint GENERATED ALWAYS AS IDENTITY,
  org_id text NOT NULL,
  project_id text NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES app.tasks (id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  exec_id text NOT NULL,
  session_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'queued', 'running', 'settled', 'failed', 'cancelled'
  )),
  harness text NOT NULL,
  model text NOT NULL,
  model_provider text,
  error text,
  result_text text,
  result_message_id text,
  trigger text CHECK (trigger IN ('manual', 'mention', 'auto_retry')),
  feedback text,
  waiting_for_capacity_at_ms bigint,
  agent_session_id text,
  session_created_at_ms bigint,
  started_by text NOT NULL,
  started_at_ms bigint NOT NULL,
  -- When the turn ACTUALLY launched, vs started_at = kick time (which
  -- includes any capacity-parked wait). Absent = the run never executed.
  launched_at_ms bigint,
  broker_token_hash text,
  api_error_status int,
  auto_retry_attempt int,
  deadline_at_ms bigint NOT NULL,
  settled_at_ms bigint,
  updated_at_ms bigint NOT NULL
);

CREATE INDEX project_agent_runs_task
  ON app.project_agent_runs (task_id, started_at_ms DESC);
CREATE INDEX project_agent_runs_task_seq
  ON app.project_agent_runs (task_id, seq DESC);
CREATE INDEX project_agent_runs_agent
  ON app.project_agent_runs (agent_id, started_at_ms DESC);
CREATE INDEX project_agent_runs_status ON app.project_agent_runs (status);
CREATE INDEX project_agent_runs_org_status
  ON app.project_agent_runs (org_id, status, started_at_ms);

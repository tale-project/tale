-- Dispatch keeps a project's ready work moving without a person, an
-- automation step or a manager agent starting each run
-- (`domains/tasks/dispatch-*.ts`). A project's dispatch names a pool of its
-- agents, how many runs they may hold at once and which columns count as
-- ready; whenever a run ends, a task becomes ready or a minute passes, a pass
-- starts the best-ranked ready tasks on idle agents of the pool, one start at
-- a time, as long as the sandbox host admits it. Its standing roles start an
-- agent on its own task on a schedule. The model (ranking, priorities,
-- assignment, review) stays with people and their manager agents.

-- One dispatch per project. `config` is the document as written
-- (`@tale/shared/schemas/project-dispatch`); `enabled` repeats its switch for
-- the scan's index.
CREATE TABLE IF NOT EXISTS app.project_dispatch (
  project_id text PRIMARY KEY REFERENCES app.projects (id) ON DELETE CASCADE,
  org_id text NOT NULL,
  config jsonb NOT NULL,
  enabled boolean NOT NULL,
  updated_by text,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS project_dispatch_enabled
  ON app.project_dispatch (org_id) WHERE enabled;

-- Where a project's dispatch stands between passes: when it last passed and
-- started a run, when it passes next, why its last pass stopped, and how far
-- into its recheck delays a host that keeps holding starts has taken it.
-- `pass_lease_until_ms` is the lease of the pass under way: one pass at a time
-- per project, and a pass whose worker died frees it when the lease runs out.
CREATE TABLE IF NOT EXISTS app.project_dispatch_state (
  project_id text PRIMARY KEY REFERENCES app.projects (id) ON DELETE CASCADE,
  org_id text NOT NULL,
  pass_lease_until_ms bigint,
  last_pass_id text,
  last_pass_at_ms bigint,
  last_start_at_ms bigint,
  next_pass_at_ms bigint,
  last_stop_reason text,
  recheck_index integer NOT NULL DEFAULT 0,
  updated_at_ms bigint NOT NULL
);

-- What each pass saw and did: the pool's occupancy, every start, every task
-- or agent it held back and why, the sandbox host's verdict with its
-- readings, and why it stopped. The readback of "why is this agent idle".
-- Kept seven days.
CREATE TABLE IF NOT EXISTS app.project_dispatch_passes (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  project_id text NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  -- What asked for the pass: `scan`, `run_ended`, `task_ready`,
  -- `capacity_cleared`, `config`, `recheck` or `manual`.
  trigger text NOT NULL,
  started_at_ms bigint NOT NULL,
  finished_at_ms bigint NOT NULL,
  occupied integer NOT NULL,
  capacity integer NOT NULL,
  started jsonb NOT NULL DEFAULT '[]',
  held jsonb NOT NULL DEFAULT '[]',
  stop_reason text NOT NULL,
  admission jsonb,
  next_pass_at_ms bigint
);
CREATE INDEX IF NOT EXISTS project_dispatch_passes_recent
  ON app.project_dispatch_passes (project_id, started_at_ms DESC);
CREATE INDEX IF NOT EXISTS project_dispatch_passes_age
  ON app.project_dispatch_passes (started_at_ms);

-- One row per occurrence of a standing role the dispatch decided: started
-- (with its run), coalesced into a run still working, refused by an admission
-- rule, or missed. The key is the occurrence, so a pass that decides it again
-- finds the row and starts nothing a second time.
CREATE TABLE IF NOT EXISTS app.project_standing_role_occurrences (
  org_id text NOT NULL,
  project_id text NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  role_key text NOT NULL,
  occurrence_at_ms bigint NOT NULL,
  -- The occurrence in the schedule's own zone, and as the UTC instant.
  label text NOT NULL,
  outcome text NOT NULL
    CHECK (outcome IN ('started', 'coalesced', 'refused', 'missed')),
  run_id text,
  reason text,
  retry_after_ms bigint,
  recorded_at_ms bigint NOT NULL,
  PRIMARY KEY (project_id, role_key, occurrence_at_ms)
);

-- A run dispatch started names its lane like an automation's or an agent's:
-- `trigger = 'dispatch'`, `started_via = 'dispatch'` and the pass (or the
-- standing role's occurrence) that started it. The previous image never writes
-- these values; it reads the trigger as an unknown one.
ALTER TABLE app.project_agent_runs
  DROP CONSTRAINT IF EXISTS project_agent_runs_trigger_check;
ALTER TABLE app.project_agent_runs
  ADD CONSTRAINT project_agent_runs_trigger_check
    CHECK (trigger IN (
      'manual', 'mention', 'auto_retry', 'automation', 'delegated', 'dispatch'
    ));
ALTER TABLE app.project_agent_runs
  DROP CONSTRAINT IF EXISTS project_agent_runs_started_via_shape;
ALTER TABLE app.project_agent_runs
  ADD CONSTRAINT project_agent_runs_started_via_shape CHECK (
    (started_via IS NULL
      AND started_via_run_id IS NULL AND started_via_node_id IS NULL
      AND started_via_automation IS NULL AND started_via_agent_id IS NULL)
    OR (started_via = 'automation'
      AND started_via_run_id IS NOT NULL
      AND started_via_node_id IS NOT NULL
      AND started_via_automation IS NOT NULL
      AND started_via_agent_id IS NULL)
    OR (started_via = 'agent'
      AND started_via_run_id IS NOT NULL
      AND started_via_agent_id IS NOT NULL
      AND started_via_node_id IS NULL
      AND started_via_automation IS NULL)
    OR (started_via = 'dispatch'
      AND started_via_run_id IS NOT NULL
      AND started_via_node_id IS NULL
      AND started_via_automation IS NULL
      AND started_via_agent_id IS NULL)
  );
ALTER TABLE app.project_agent_runs
  DROP CONSTRAINT IF EXISTS project_agent_runs_started_via_trigger;
ALTER TABLE app.project_agent_runs
  ADD CONSTRAINT project_agent_runs_started_via_trigger CHECK (
    (trigger = 'automation' AND started_via = 'automation')
    OR (trigger = 'delegated' AND started_via = 'agent')
    OR (trigger = 'dispatch' AND started_via = 'dispatch')
    OR (trigger IS DISTINCT FROM 'automation'
      AND trigger IS DISTINCT FROM 'delegated'
      AND trigger IS DISTINCT FROM 'dispatch'
      AND (started_via IS NULL OR trigger = 'auto_retry'))
  );

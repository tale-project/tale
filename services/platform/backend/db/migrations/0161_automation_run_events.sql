-- What happened to a run between its steps that its checkpoints cannot say:
-- a server taking it over after another stopped responding, a hand-off
-- because its server was shutting down, a step interrupted, a write that may
-- already have happened, an engine too old to read its progress.
--
-- Append-only: rows are only ever inserted, and leave with their run
-- (cascade) through deletion, retention and erasure. `detail` holds ids,
-- indices and reasons, never a step's input or output.
--
-- Rolling-deploy safe: a new table the previous image never reads; its run
-- deletes cascade into it, and organization teardown finds it by its
-- `org_id` column.
CREATE TABLE IF NOT EXISTS app.automation_run_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL REFERENCES app.automation_runs (id) ON DELETE CASCADE,
  org_id text NOT NULL,
  at_ms bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'taken_over', 'handed_off', 'lease_expired', 'node_interrupted',
    'in_doubt', 'in_doubt_resolved', 'engine_deferred'
  )),
  -- The process that observed it (host:pid:version:colour), never sent to a
  -- client.
  instance text,
  -- TALE_VERSION of that process.
  engine_version text,
  detail jsonb
);

CREATE INDEX IF NOT EXISTS automation_run_events_run
  ON app.automation_run_events (run_id, at_ms);
CREATE INDEX IF NOT EXISTS automation_run_events_org
  ON app.automation_run_events (org_id);

-- Where a run came from when a person ran another one again: the run it
-- replays, how (`again` with the same input, `edited` with an input the
-- person changed, or `from` a step — a fork that kept the steps the run
-- finished outside that step and what it feeds), and from which step. Who
-- replayed it is the run's own `started_by`.
--
-- The link survives as `replay_kind` when the source run is deleted
-- (retention, erasure, a person): the run still says it was a replay.
--
-- Rolling-deploy safe: nullable columns the previous image never selects;
-- its deletes of a source run null the link.
ALTER TABLE app.automation_runs
  ADD COLUMN IF NOT EXISTS replay_of_run_id text
    REFERENCES app.automation_runs (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replay_kind text
    CHECK (replay_kind IN ('again', 'edited', 'from')),
  ADD COLUMN IF NOT EXISTS replay_from_node text;

CREATE INDEX IF NOT EXISTS automation_runs_replay_of
  ON app.automation_runs (replay_of_run_id)
  WHERE replay_of_run_id IS NOT NULL;

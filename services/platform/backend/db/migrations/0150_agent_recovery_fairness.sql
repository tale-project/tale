-- A failed/offline recovery probe must not keep the oldest 25 runs ahead
-- of every reachable run forever. These probe clocks are independent of
-- liveness: inspecting a run never makes its agent or drainer look healthy.
-- Nullable additions keep the previous image working during a rolling deploy.
ALTER TABLE app.project_agent_runs
  ADD COLUMN IF NOT EXISTS recovery_checked_at_ms bigint;
ALTER TABLE app.automation_runs
  ADD COLUMN IF NOT EXISTS recovery_checked_at_ms bigint;

CREATE INDEX IF NOT EXISTS project_agent_runs_recovery_visit
  ON app.project_agent_runs (recovery_checked_at_ms ASC NULLS FIRST, updated_at_ms, id)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS automation_runs_recovery_visit
  ON app.automation_runs (recovery_checked_at_ms ASC NULLS FIRST, started_at_ms, id)
  WHERE status = 'waiting';

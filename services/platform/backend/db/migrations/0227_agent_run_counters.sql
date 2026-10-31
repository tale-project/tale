-- How often project agents' runs waited for room, were woken and failed: the
-- running totals the backend's metrics restate on every scrape
-- (`tale_backend_agent_run_parks_total`, `…_wakes_total`,
-- `…_wake_failures_total`, `…_failures_total`; `backend/telemetry.ts`).
--
-- The events happen in worker jobs (the turn host's park, a run's timed wake,
-- the watchdogs, every failure), and a worker serves no `/metrics`: a counter
-- kept in its memory would never reach a scrape. So each event adds to one
-- row here once its own transaction has committed, and the API reads the rows
-- back (`domains/tasks/agent-run-counters.ts`). One row per (event, label):
-- `event` says what happened, `label` is from a closed set (a waiting reason,
-- a wake source, a failure code, or `unknown`), so the table stays a few
-- dozen rows however many runs a deployment has.
--
-- Deployment totals, not an organization's data: no `org_id`, nothing an
-- organization's deletion or export walks. Rolling-deploy safe: a new table
-- the previous image neither writes nor reads; the totals start from zero.
CREATE TABLE IF NOT EXISTS app.agent_run_counters (
  event text NOT NULL
    CHECK (event IN ('park', 'wake', 'wake_failure', 'failure')),
  label text NOT NULL,
  total bigint NOT NULL DEFAULT 0 CHECK (total >= 0),
  PRIMARY KEY (event, label)
);

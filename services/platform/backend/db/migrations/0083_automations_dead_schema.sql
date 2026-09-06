-- Retire the automation schema nothing reads or writes.
--
-- 0019 shipped three pieces of shape no code ever touched:
--
--   * `app.automation_upload_intents` — the single-use ownership record for
--     an uploaded package blob. The upload lane landed on the shared
--     `app.upload_intents` (domains/files/upload-intents.ts, migration 0067)
--     instead, so this table has had no reader and no writer since the pg
--     port; repo-wide its name occurs only in 0019.
--   * `automation_runs.lifecycle_status` and `status_changed_at_ms` — the
--     status a run carries lives in `status` (queued / running / waiting /
--     success / failed / cancelled) with `started_at_ms` / `finished_at_ms`;
--     no INSERT or UPDATE in the store names these two, so every row has
--     NULL in both.
--   * `automation_runs_org_lifecycle` — the index over that all-NULL column,
--     maintained on every run write for a lookup nothing issues.
--
-- Dropping them is the retire-a-column doctrine's second step with the
-- first already met: no shipped image has ever read these, so the previous
-- image keeps working against the new shape (the store selects and writes
-- explicit column lists). Idempotent: a re-run after a half-failed deploy
-- finds nothing to drop.

DROP TABLE IF EXISTS app.automation_upload_intents;

DROP INDEX IF EXISTS app.automation_runs_org_lifecycle;

ALTER TABLE app.automation_runs
  DROP COLUMN IF EXISTS lifecycle_status,
  DROP COLUMN IF EXISTS status_changed_at_ms;

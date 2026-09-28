-- A trigger's failure streak, and the schedule pause it leads to.
--
-- A schedule whose automation fails for a reason the next occurrence cannot
-- outwait — the author's node throws, a connector refuses, the provider key
-- is missing or rejected, the credit is spent — used to fire forever: every
-- occurrence started a run that failed the same way, spent what it could and
-- told nobody (one such schedule logged 5,370 errors in ten days, #3092).
-- `finishRun` now keeps a streak per trigger, in the transaction that lands
-- the run:
--
--   consecutive_failures  permanent failures in a row among the runs this
--                         trigger started since it was last saved. A success
--                         sets it back to 0, and so does saving the trigger;
--                         a transient failure (a rate limit, an unreachable
--                         provider, an agent turn that ran out of time) or a
--                         cancel neither counts nor breaks the streak.
--   last_failed_at_ms     the last permanent failure: when its run finished,
--   last_failure_code     its `failure_code`, and the run itself — a deleted
--   last_failed_run_id    run leaves NULL behind (ON DELETE SET NULL) rather
--                         than a dangling id, like `last_run_id` (0096).
--
-- When a SCHEDULE's streak reaches the pause threshold the same transaction
-- turns it off: `enabled = false`, `last_skip_reason =
-- 'paused_after_failures'` and `last_skipped_at_ms` = the moment it paused —
-- the skip ledger says why the schedule no longer starts anything until a
-- person saves it again (which clears the reason). The pause writes an audit
-- row and notifies the organization's owners and admins (`automation_failed`,
-- gated by the `automation_alerts` preference column 0028 kept for it).
-- Webhook and event triggers keep a streak but are never paused: their runs
-- are started by a sender or a platform event, not by the platform's clock.
--
-- Rolling deploy: the previous image neither reads nor writes the new
-- columns and never writes the new skip reason; a trigger it re-enables
-- keeps the streak it had, which the new image reads as stale because the
-- save moved `updated_at_ms` past the last failure (the counter starts over).
-- No backfill: every trigger starts with an empty streak.

ALTER TABLE app.automation_triggers
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0
    CHECK (consecutive_failures >= 0),
  ADD COLUMN IF NOT EXISTS last_failed_at_ms bigint,
  ADD COLUMN IF NOT EXISTS last_failure_code text,
  ADD COLUMN IF NOT EXISTS last_failed_run_id text
    REFERENCES app.automation_runs(id) ON DELETE SET NULL;

-- The FK check on every run delete (a retention purge deletes runs by the
-- thousand) finds the one referencing row by index, as for `last_run_id`.
CREATE INDEX IF NOT EXISTS automation_triggers_last_failed_run
  ON app.automation_triggers (last_failed_run_id)
  WHERE last_failed_run_id IS NOT NULL;

-- The skip ledger's closed set gains the pause (0096 named the column's
-- CHECK implicitly; the name below is the one Postgres gave it).
ALTER TABLE app.automation_triggers
  DROP CONSTRAINT IF EXISTS automation_triggers_last_skip_reason_check;
ALTER TABLE app.automation_triggers
  ADD CONSTRAINT automation_triggers_last_skip_reason_check
    CHECK (last_skip_reason IN (
      'not_deployed', 'unusable_cron', 'start_refused', 'paused_after_failures'
    ));

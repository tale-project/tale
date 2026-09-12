-- The trigger fire ledger: what a schedule last came due for, the run a
-- trigger last started, and the last time it came due and started nothing.
--
-- `last_fired_at_ms` used to be the schedule scan's CLAIM: the scan stamped
-- the due minute on the row BEFORE asking the store for a run, so a schedule
-- whose automation had nothing deployed "fired" every occurrence — the one
-- health field the API shows advanced on bindings that had never started a
-- run (the worker logged "3 due schedule(s) have no deployed version to run"
-- every tick while `lastFiredAt` ticked with it). The claim and the fire are
-- two facts now:
--
--   last_due_at_ms      the occurrence the scan last CLAIMED (the cursor an
--                       overlapping scan loses against). Backfilled from the
--                       old stamp for schedule rows so no occurrence before
--                       this migration fires again.
--   last_fired_at_ms    now means what its name says: the last occurrence
--                       (schedule) or moment (event, webhook) this binding
--                       STARTED A RUN for — stamped in the transaction that
--                       inserts the run, never before.
--   last_run_id         the run that stamp names; a deleted run leaves NULL
--                       behind (ON DELETE SET NULL) rather than a dangling id.
--   last_skipped_at_ms  the last time the binding came due and started
--   last_skip_reason    nothing, and why: `not_deployed` (no deployed
--                       version), `unusable_cron` (the expression or zone
--                       could not be read — the scan leaves the row alone
--                       until it is edited), `start_refused` (the deployed
--                       version refused the run's input).
--
-- A re-bind that changes the kind clears all four with the old stamp — a
-- fresh trigger inherits no history (the store's upsert CASE).
--
-- Rolling deploy: the previous image keeps claiming on `last_fired_at_ms`
-- alone while this one reads GREATEST(last_due_at_ms, last_fired_at_ms) —
-- an old-image claim advances the new image's cursor too, and the new
-- image's fire stamp satisfies the old image's `last_fired_at_ms < due`
-- test, so an occurrence fires at most once in either direction. The one
-- window: an occurrence the new image claims for an UNDEPLOYED automation
-- (a skip stamp, no fire stamp) is also claimed by an old image — which
-- starts nothing either, but stamps `last_fired_at_ms` the old way, so a
-- fire stamp with no `last_run_id` beside it during the roll is that claim.
-- Nothing in the previous image reads the new columns.
--
-- The same file NULLs the keys of another kind that the old doors stored as
-- sent (`cron`/`timezone` on a webhook, `event` on a schedule): the doors
-- refuse them now, and a stored one read back as a webhook that also ran on
-- a schedule. Set-based and idempotent; a second run touches no row.

ALTER TABLE app.automation_triggers
  ADD COLUMN IF NOT EXISTS last_due_at_ms bigint,
  ADD COLUMN IF NOT EXISTS last_run_id text
    REFERENCES app.automation_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_skipped_at_ms bigint,
  ADD COLUMN IF NOT EXISTS last_skip_reason text
    CHECK (last_skip_reason IN ('not_deployed', 'unusable_cron', 'start_refused'));

-- The FK check on every run delete (a retention purge deletes runs by the
-- thousand) finds the one referencing row by index, not by scanning the
-- table; NULL rows are the bulk and need no entry.
CREATE INDEX IF NOT EXISTS automation_triggers_last_run
  ON app.automation_triggers (last_run_id)
  WHERE last_run_id IS NOT NULL;

-- The claim cursor starts where the old stamp left it, so no occurrence
-- before this migration fires again.
UPDATE app.automation_triggers
SET last_due_at_ms = last_fired_at_ms
WHERE kind = 'schedule'
  AND last_due_at_ms IS NULL
  AND last_fired_at_ms IS NOT NULL;

-- The run the fire stamp names: the newest run this trigger started (runs
-- record their trigger as `trigger:<id>`).
UPDATE app.automation_triggers t
SET last_run_id = (
  SELECT r.id FROM app.automation_runs r
  WHERE r.org_id = t.org_id AND r.started_by = 'trigger:' || t.id
  ORDER BY r.started_at_ms DESC, r.id DESC
  LIMIT 1
)
WHERE t.last_run_id IS NULL
  AND t.last_fired_at_ms IS NOT NULL;

-- A schedule's or an event trigger's fire stamp on a binding that never
-- started a run is the old claim, not a fire — both paths stamped before
-- asking the store for a run, and the seeded schedules of an undeployed
-- catalog carried one that ticked every occurrence. It reads as null now
-- (the cursor above keeps the claim). A webhook's stamp was always written
-- after its run and is kept as it is. A binding that fired at least once
-- keeps its stamp, which may be later than its last run where the
-- automation was undeployed since: history the row cannot reconstruct.
UPDATE app.automation_triggers
SET last_fired_at_ms = NULL
WHERE kind IN ('schedule', 'event')
  AND last_fired_at_ms IS NOT NULL
  AND last_run_id IS NULL;

-- Keys of another kind, stored before the doors refused them.
UPDATE app.automation_triggers
SET cron = NULL, timezone = NULL
WHERE kind <> 'schedule'
  AND (cron IS NOT NULL OR timezone IS NOT NULL);

UPDATE app.automation_triggers
SET event = NULL
WHERE kind <> 'event'
  AND event IS NOT NULL;

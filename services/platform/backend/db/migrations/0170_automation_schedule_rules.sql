-- Native repeat rules beside cron, the next-due instant the scan claims by,
-- and what a schedule does with occurrences it missed.
--
-- A schedule used to be a cron expression only, and the scan walked every
-- enabled schedule every minute and searched the last hour backwards for an
-- occurrence: O(all schedules) per tick, and an occurrence older than an
-- hour was dropped without a word (a monthly 09:00 after an outage from
-- 08:30 to 10:30 never ran). Three columns change that:
--
--   schedule_rule   the repeat rule the editor's picker writes, as
--                   {"repeat": ScheduleRule, "startDate": "YYYY-MM-DD"}
--                   (`@tale/shared/schemas/schedule-rule`, validated by the
--                   app). NULL on a cron row. A non-empty `cron` wins over a
--                   rule: a previous image that knows only cron and saves
--                   over a rule row writes the newer intent there.
--   catch_up        'skip' starts a missed occurrence only when it is at most
--                   ten minutes late; NULL reads as 'latest' (the most recent
--                   missed occurrence starts once, however late), so the
--                   default keeps managed configuration hashes unchanged.
--   next_due_at_ms  the earliest occurrence not handled yet. The scan claims
--                   rows whose instant has come by the partial index below,
--                   one row lock at a time. NULL means "not computed": a row
--                   a previous image inserted or edited, every row before the
--                   first scan after this migration, a schedule switched off.
--                   The scan computes it from the later of the claim, the
--                   fire and the last save, so nothing from before a save is
--                   made up. No backfill: that first pass is the backfill.
--
-- Rolling deploy: the previous image neither reads nor writes these columns.
-- Its scan skips a row with no cron (a rule row) and claims cron rows through
-- `GREATEST(last_due_at_ms, last_fired_at_ms)`, which the new scan also
-- honours, so an occurrence fires at most once whichever image holds the
-- minute. What it changes about a schedule — its upsert, the pause after
-- failures, the switch-off of an orphaned binding — goes through the trigger
-- below, which drops a stale next-due instant so the scan recomputes it.

ALTER TABLE app.automation_triggers
  ADD COLUMN IF NOT EXISTS schedule_rule jsonb
    CHECK (schedule_rule IS NULL OR jsonb_typeof(schedule_rule) = 'object'),
  ADD COLUMN IF NOT EXISTS catch_up text
    CHECK (catch_up IN ('latest', 'skip')),
  ADD COLUMN IF NOT EXISTS next_due_at_ms bigint;

-- The scan's two walks: the schedules whose instant has come, most overdue
-- first, and the ones whose instant is not computed yet.
CREATE INDEX IF NOT EXISTS automation_triggers_next_due
  ON app.automation_triggers (next_due_at_ms, id)
  WHERE kind = 'schedule' AND enabled AND next_due_at_ms IS NOT NULL;
CREATE INDEX IF NOT EXISTS automation_triggers_next_due_unset
  ON app.automation_triggers (id)
  WHERE kind = 'schedule' AND enabled AND next_due_at_ms IS NULL;

-- Any writer that changes what a schedule IS, or whether it runs, without
-- also writing when it is next due leaves NULL behind: the scan recomputes
-- the instant instead of firing one the old definition named. The new
-- image's save writes both and passes through.
CREATE OR REPLACE FUNCTION app.automation_trigger_next_due_reset()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.next_due_at_ms IS NOT DISTINCT FROM OLD.next_due_at_ms
     AND (NEW.kind, NEW.enabled, NEW.cron, NEW.timezone, NEW.schedule_rule)
         IS DISTINCT FROM
         (OLD.kind, OLD.enabled, OLD.cron, OLD.timezone, OLD.schedule_rule)
  THEN
    NEW.next_due_at_ms := NULL;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS automation_triggers_next_due_reset
  ON app.automation_triggers;
CREATE TRIGGER automation_triggers_next_due_reset
  BEFORE UPDATE OF kind, enabled, cron, timezone, schedule_rule
  ON app.automation_triggers
  FOR EACH ROW EXECUTE FUNCTION app.automation_trigger_next_due_reset();

-- A blank or padded zone saved green and never fired: `Intl` refuses '' and
-- ' Europe/Zurich', so the scan stamped the schedule unusable and left it.
-- Trim it (a blank one reads as UTC, as a cron without a zone always has).
-- A schedule parked by that stamp resumes from now — the save moves, the
-- stamp clears — which is what its author saved it to do; the time it sat
-- parked is not made up.
UPDATE app.automation_triggers
SET timezone = NULLIF(btrim(timezone), ''),
    last_skip_reason = CASE
      WHEN last_skip_reason = 'unusable_cron' THEN NULL
      ELSE last_skip_reason
    END,
    last_skipped_at_ms = CASE
      WHEN last_skip_reason = 'unusable_cron' THEN NULL
      ELSE last_skipped_at_ms
    END,
    updated_at_ms = (extract(epoch FROM clock_timestamp()) * 1000)::bigint
WHERE timezone IS DISTINCT FROM NULLIF(btrim(timezone), '');

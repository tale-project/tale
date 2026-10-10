-- Why a trigger last started nothing, in words a person can act on, and a
-- skip reason for occurrences a schedule missed.
--
--   last_skip_detail  the facts behind `last_skip_reason`
--                     (`@tale/shared/schemas/automation-trigger`,
--                     `triggerSkipDetailSchema`): the occurrence or event it
--                     was about; for a refused start the refusal's code, the
--                     version that refused it, its sentence (at most 500
--                     characters) and up to ten problems; and how many
--                     occurrences were missed alongside. The editor words it
--                     by reason and code and keeps the raw text behind
--                     "Technical details". A pause after failures has none
--                     (its facts are the failure columns), and a detail whose
--                     own reason is not the row's reason is stale and not
--                     read — a previous image stamps a reason without one.
--                     Capped at 8 KiB so a refusal can never bloat the row.
--
-- `missed_occurrences` joins the skip ledger's closed set: a schedule that
-- was not running when occurrences came due counts them (up to 1,000) and
-- says so, where it used to drop them in silence.
--
-- Rolling deploy: the previous image neither reads nor writes the detail.
-- It reads the new reason as a plain string its screen shows nothing for,
-- and never writes it.

ALTER TABLE app.automation_triggers
  ADD COLUMN IF NOT EXISTS last_skip_detail jsonb
    CHECK (
      last_skip_detail IS NULL
      OR (
        jsonb_typeof(last_skip_detail) = 'object'
        AND octet_length(last_skip_detail::text) <= 8192
      )
    );

ALTER TABLE app.automation_triggers
  DROP CONSTRAINT IF EXISTS automation_triggers_last_skip_reason_check;
ALTER TABLE app.automation_triggers
  ADD CONSTRAINT automation_triggers_last_skip_reason_check
    CHECK (last_skip_reason IN (
      'not_deployed', 'unusable_cron', 'start_refused', 'paused_after_failures',
      'missed_occurrences'
    ));

-- Where an automation's steps carry on between its runs.
--
-- A scheduled automation that works through more than one run can hold — a
-- digest's window of new tasks, the issues changed since the last triage —
-- keeps its place here: one small JSON value per automation, project and key,
-- read by `automation.read_position` at the start of a run and saved by
-- `automation.save_position` at its end. A run that fails before its end
-- saves nothing, so the next run starts from the same place again. The run
-- history is no place for it: the retention policy and people remove runs,
-- and a manual run for another repository is a run too.
--
--   project_id   the project the run belongs to; '' for a run of the
--                organization, so each project keeps its own place.
--   key          the step's own name for the place (a repository, 'window').
--   value        what the step saved: at most 16 KiB of JSON.
--   revision     the compare token a save hands back, drawn from
--                automation_position_revisions: new on every save and never
--                repeated, so a save from an overlapping run, or one that
--                read before another save, is refused instead of moving the
--                place back.
--   run_id       the run that saved it.
--
-- The rows belong to the automation: deleting it deletes them, so an
-- automation created later under the same name starts with no place, and an
-- organization's deletion takes them with its other org_id rows.
--
-- Rolling-deploy safe: a new table the previous image never reads.

CREATE SEQUENCE IF NOT EXISTS app.automation_position_revisions;

CREATE TABLE IF NOT EXISTS app.automation_positions (
  org_id text NOT NULL,
  automation_name text NOT NULL,
  project_id text NOT NULL DEFAULT '',
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 200),
  value jsonb NOT NULL CHECK (octet_length(value::text) <= 16384),
  revision bigint NOT NULL,
  run_id text,
  updated_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, automation_name, project_id, key)
);

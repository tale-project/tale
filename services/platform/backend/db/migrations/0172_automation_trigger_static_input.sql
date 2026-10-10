-- A trigger's fixed input: values every run it starts receives.
--
-- A trigger used to hand its run the trigger's own fields only — a schedule
-- `{trigger, firedAt}`, a webhook `{trigger, payload}`, an event `{trigger,
-- event, payload}` — so an automation that needs a value no trigger carries
-- (the GitHub packs need `owner` and `repo`) refused every start a trigger
-- made, and only a run started by hand could pass it. `run_input` is the
-- JSON object the trigger adds to each run's input, under its own fields:
-- the trigger's `trigger`, `firedAt`, `event` and `payload` are set over it,
-- so a fixed input can never pretend to be another trigger. Validated by the
-- app (`staticInputSchema` in `@tale/shared/schemas/automation-trigger`: an
-- object, none of those four keys, at most 16 KiB as JSON); the CHECK holds
-- the object, and a size against any other writer at twice that, since
-- jsonb's own text adds a space after every colon and comma. NULL is none.
--
-- Rolling deploy: the previous image neither reads nor writes the column.
-- Its runs start without the fixed input, as they always have, and its
-- upsert leaves the column as it was.

ALTER TABLE app.automation_triggers
  ADD COLUMN IF NOT EXISTS run_input jsonb
    CHECK (
      run_input IS NULL
      OR (
        jsonb_typeof(run_input) = 'object'
        AND octet_length(run_input::text) <= 32768
      )
    );

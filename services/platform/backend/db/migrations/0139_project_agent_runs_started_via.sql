-- Who put a project agent to work when no person pressed Start: an
-- automation's `task.start_agent` step (a schedule's occurrence, or a run a
-- person started), or another project agent's run through the granted
-- `task_start_agent` tool.
--
-- Until now every project-agent run began with a person's gesture (Start
-- agent, a move to In progress, an @mention) or an auto-retry of one, so
-- `trigger` knew three values and `started_by` always named a person. Two
-- new kicks join them:
--
--   trigger = 'automation'  an automation run's `task.start_agent` step
--                           started it.
--   trigger = 'delegated'   another agent's run started it with
--                           `task_start_agent`.
--
-- Either way the card moves to In progress and the result waits for a person
-- at In review, exactly as after Start agent — unless the start asked to work
-- in place (`moveToInProgress: false`, `in_place` below): a standing role runs
-- on its card every occurrence without a review bell each time.
--
-- `started_by` keeps naming the door the WHOLE chain answers to: the person
-- who started the delegating run (or the automation run), or
-- `trigger:<triggerId>` when a schedule's occurrence began the chain — the
-- same format automation runs carry (`lib/shared/run-starter.ts`). A run a
-- schedule began books under the `__automation__` subject, and its connector
-- calls act for nobody, like every other run a trigger starts.
--
--   started_via           'automation' | 'agent' — set on the kick above and
--                         carried by its auto-retries (trigger 'auto_retry'),
--                         so a retried delegated run is still one: it may not
--                         delegate in turn, and it still counts as automated.
--   started_via_run_id    the automation run, or the delegating agent run.
--                         Plain text, no FK: a run a retention sweep deletes
--                         must not take the provenance of the runs it began.
--   started_via_node_id   the automation step that started it.
--   started_via_automation the automation's name, kept for display after the
--                         automation run is gone.
--   started_via_agent_id  the delegating project agent.
--   in_place              the start left the card where it stood
--                         (`moveToInProgress: false`): the run's successful
--                         completion neither moves the card nor requests a
--                         review, whatever column the card is in by then (a
--                         person may have moved a standing role's card to In
--                         progress). Recorded at the kick and carried by its
--                         auto-retries; the completion reads it, never infers
--                         it from the card's column or the run's origin. Only
--                         a run with `started_via` may be in place.
--
-- The slot receipt: an automation step starts a given task at most once per
-- automation run — the unique index below. A step the engine re-delivers
-- after a crash finds the run the first delivery started instead of a
-- second one (an occurrence of a schedule is one automation run: the scan's
-- claim, 0096). Auto-retries copy the via columns and are left out.
--
-- Rolling-deploy safe: nullable columns and a NOT NULL DEFAULT false one,
-- and the widened CHECK admits every value the previous image writes. Its retry of a run started this way
-- writes no via columns (the retry's provenance is lost for that window,
-- nothing else), and its task card shows the new trigger values as raw keys
-- until the roll completes.

ALTER TABLE app.project_agent_runs
  DROP CONSTRAINT IF EXISTS project_agent_runs_trigger_check;
ALTER TABLE app.project_agent_runs
  ADD CONSTRAINT project_agent_runs_trigger_check
    CHECK (trigger IN (
      'manual', 'mention', 'auto_retry', 'automation', 'delegated'
    ));

ALTER TABLE app.project_agent_runs
  ADD COLUMN IF NOT EXISTS started_via text,
  ADD COLUMN IF NOT EXISTS started_via_run_id text,
  ADD COLUMN IF NOT EXISTS started_via_node_id text,
  ADD COLUMN IF NOT EXISTS started_via_automation text,
  ADD COLUMN IF NOT EXISTS started_via_agent_id text,
  ADD COLUMN IF NOT EXISTS in_place boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'app.project_agent_runs'::regclass
      AND conname = 'project_agent_runs_started_via_shape'
  ) THEN
    ALTER TABLE app.project_agent_runs
      ADD CONSTRAINT project_agent_runs_started_via_shape CHECK (
        (started_via IS NULL
          AND started_via_run_id IS NULL AND started_via_node_id IS NULL
          AND started_via_automation IS NULL AND started_via_agent_id IS NULL)
        OR (started_via = 'automation'
          AND started_via_run_id IS NOT NULL
          AND started_via_node_id IS NOT NULL
          AND started_via_automation IS NOT NULL
          AND started_via_agent_id IS NULL)
        OR (started_via = 'agent'
          AND started_via_run_id IS NOT NULL
          AND started_via_agent_id IS NOT NULL
          AND started_via_node_id IS NULL
          AND started_via_automation IS NULL)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'app.project_agent_runs'::regclass
      AND conname = 'project_agent_runs_started_via_trigger'
  ) THEN
    -- The kick names its lane; a retry carries it; nothing else may.
    ALTER TABLE app.project_agent_runs
      ADD CONSTRAINT project_agent_runs_started_via_trigger CHECK (
        (trigger = 'automation' AND started_via = 'automation')
        OR (trigger = 'delegated' AND started_via = 'agent')
        OR (trigger IS DISTINCT FROM 'automation'
          AND trigger IS DISTINCT FROM 'delegated'
          AND (started_via IS NULL OR trigger = 'auto_retry'))
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'app.project_agent_runs'::regclass
      AND conname = 'project_agent_runs_in_place_automated'
  ) THEN
    ALTER TABLE app.project_agent_runs
      ADD CONSTRAINT project_agent_runs_in_place_automated
        CHECK (NOT in_place OR started_via IS NOT NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS project_agent_runs_automation_step
  ON app.project_agent_runs (started_via_run_id, started_via_node_id, task_id)
  WHERE trigger = 'automation';

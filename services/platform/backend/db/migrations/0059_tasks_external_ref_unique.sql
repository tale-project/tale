-- One task per (project, external_system, external_id) — DB-enforced.
--
-- The external-ref intake (`upsertTaskByExternalRef`, driving the session
-- create-task door, REST `POST /api/v1/tasks`, and the sandbox task_upsert
-- shim) used to dedupe by SELECT-then-INSERT with only a plain index
-- (`tasks_org_external`, 0009): two concurrent intakes of the same external
-- item — a retried webhook, a double-submitted sync — each saw "no task" in
-- READ COMMITTED and both inserted, duplicating the task AND the workflow
-- run started for it. This file makes the dedupe a rule the database cannot
-- forget; the upsert now inserts with ON CONFLICT DO NOTHING against this
-- index and reconciles the winner's row when it loses the race.
--
-- The key is per PROJECT, not per org, because `dedupeScope: 'project'`
-- legitimately allows the same external ref in two projects of one org (one
-- task per issue per project). Org-scope dedupe across different projects
-- stays advisory (lookup-only) for that reason.
--
-- Existing duplicates are resolved DETERMINISTICALLY before the index: per
-- (project_id, external_system, external_id) group the OLDEST row — lowest
-- created_at_ms, id as the tiebreak — keeps the external binding; every
-- newer duplicate is detached from the ref (external_system/external_id set
-- NULL) rather than deleted, so no task data, comments, or runs are lost.
-- Detached duplicates keep their external_url for human traceability.
--
-- Rolling-deploy safe: the previous image is still serving while this
-- applies. Its SELECT-then-INSERT keeps working for every non-racing
-- request; the formerly-duplicating race now surfaces as a unique-violation
-- error on the loser instead of a silent duplicate, which is the safe side
-- of the trade until the new image takes over.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY project_id, external_system, external_id
           ORDER BY created_at_ms ASC, id ASC
         ) AS keep_rank
  FROM app.tasks
  WHERE external_system IS NOT NULL AND external_id IS NOT NULL
)
UPDATE app.tasks
SET external_system = NULL, external_id = NULL
FROM ranked
WHERE app.tasks.id = ranked.id AND ranked.keep_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_project_external_unique
  ON app.tasks (project_id, external_system, external_id)
  WHERE external_system IS NOT NULL AND external_id IS NOT NULL;

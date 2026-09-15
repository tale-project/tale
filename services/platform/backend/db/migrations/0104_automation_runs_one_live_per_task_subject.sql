-- One live automation run per TASK SUBJECT, whichever automation runs it.
--
-- 0102 put the rule in the schema keyed on (org, automation name, project,
-- task): a task with a live run of automation A still admitted a start of
-- automation B on the same task, and two engines then mutated one card at
-- once (2026-09-14 evaluation, round h, S2-3). The docs, the OpenAPI
-- operation and the API reference all state the rule per task ("one engine
-- per task", "a task with a live run refuses a second one"), and the product
-- rule is per task too — reassigning mid-run is refused outright. The name
-- leaves the key; the advisory lock and the live-run probe in
-- `backend/domains/tasks/external-ref.ts` move with it.
--
-- Rolling-deploy safe the way 0102 was: the previous image starts at most the
-- runs it already started, so it never violates the stricter rule except by
-- the cross-automation start the new contract refuses anyway — inside the
-- roll window that one start answers a unique violation its name-filtered
-- reconcile cannot resolve, which is a 500 for that request, not a second
-- run. Ship the code and this file in one release.

-- 1. Collapse cross-automation live duplicates per (org, project, task
--    subject), keeping the earliest-started run — the one every later start
--    should have reused — as 0102 did within one name. Duplicates are
--    erroneous by definition: the guard was always meant to allow one. A
--    cancelled row leaves the live set; a later settle of its worker is
--    skipped by the run's own idempotency gate (status no longer live).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY org_id, project_id, (input -> 'task' ->> 'id')
           ORDER BY started_at_ms ASC, id ASC
         ) AS rn
  FROM app.automation_runs
  WHERE status IN ('queued', 'running', 'waiting')
    AND input -> 'task' ->> 'id' IS NOT NULL
)
UPDATE app.automation_runs r
SET status = 'cancelled',
    finished_at_ms = (extract(epoch FROM now()) * 1000)::bigint,
    wake_at_ms = NULL
FROM ranked
WHERE r.id = ranked.id AND ranked.rn > 1;

-- 2. The rule, per task subject. `project_id` stays in the key: the task door
--    attributes every run to the task's project and the probe filters on it;
--    a run with no task subject carries a NULL there and is outside the index.
CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_one_live_per_task_subject
  ON app.automation_runs (org_id, project_id, (input -> 'task' ->> 'id'))
  WHERE status IN ('queued', 'running', 'waiting')
    AND input -> 'task' ->> 'id' IS NOT NULL;

-- 3. The 0102 index is implied by the new one (per-task uniqueness ⇒
--    per-(task, name) uniqueness) and only cost a write per insert; no code
--    names it — the doors catch the SQLSTATE, never the index name.
DROP INDEX IF EXISTS app.automation_runs_one_live_per_task;

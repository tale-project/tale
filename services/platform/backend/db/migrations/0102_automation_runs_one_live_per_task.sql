-- One live automation run per task — the invariant the start guard could not
-- keep on its own.
--
-- `POST /api/v1/projects/{id}/tasks/{taskId}/start` promises "a concurrent
-- start reuses the live run" (`reason: "already_running"`), but the guard was
-- a check-then-act: the REST door ran the live-run lookup and the insert
-- inside ONE serializable transaction, whose snapshot is frozen at the
-- transaction's first statement — so several starts released together each
-- read "no live run" from a snapshot that predated the others' inserts and
-- each began a SEPARATE billable run (2026-09-14 evaluation, g5-1: six
-- simultaneous starts → five runs, all executed). The advisory lock the
-- guard takes serialises the doors, but a lock taken INSIDE a transaction is
-- acquired after the snapshot and cannot make an older snapshot see a newer
-- commit.
--
-- The rule moves into the schema, where a snapshot cannot dodge it: at most
-- one run per (org, automation name, project, task subject) may sit in a live
-- state. A racer's INSERT now conflicts with the winner's committed row — as
-- a serialization failure under SERIALIZABLE (the whole transaction retries,
-- and the retry's fresh snapshot sees the winner and answers
-- `already_running`), or as a plain unique violation the start reconciles by
-- re-reading the winner. The task subject id lives in `input -> 'task' ->>
-- 'id'`, the same expression `findLiveAutomationRunForTask` keys on; a run
-- with no task subject (a plain automation run) carries a NULL there and is
-- outside the index, so this constrains task-linked runs only.
--
-- Rolling-deploy safe: a partial UNIQUE index the previous image never
-- violates (it starts at most the runs it already started; the new image is
-- the one that enforces one-per-task). Existing live duplicates — the bug's
-- own residue — would fail the CREATE, so they are collapsed first: the
-- earliest-started run of each group is kept (the one the race should have
-- reused) and the rest are cancelled. Duplicates are erroneous by
-- definition — the guard was always meant to allow exactly one — so this
-- removes nothing a correct run of the platform would have produced.

-- 1. Collapse any existing live-run duplicates onto the earliest, so the
--    unique index can be built. A cancelled row leaves the live set and the
--    index; a later settle of its worker is skipped by the run's own
--    idempotency gate (status is no longer queued/running).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY org_id, name, project_id, (input -> 'task' ->> 'id')
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

-- 2. The rule: one live run per (org, automation, project, task subject).
CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_one_live_per_task
  ON app.automation_runs (org_id, name, project_id, (input -> 'task' ->> 'id'))
  WHERE status IN ('queued', 'running', 'waiting')
    AND input -> 'task' ->> 'id' IS NOT NULL;

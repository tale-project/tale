-- 0.5 app migration 0080: at most ONE live project-agent run per task.
--
-- Why: every lane over `app.project_agent_runs` assumes a task has at most
-- one run at `queued`/`running` — the steer picks "the" running run, the
-- cancel-live door cancels LIMIT 1, the settle parks the card for "its" run,
-- the auto-retry checks "the newest run". The kick (`kickAgentRun`) enforced
-- that with a SELECT-then-INSERT and no constraint. The human doors run
-- SERIALIZABLE, but the auto-retry job and the mention-kick fallback kick
-- under READ COMMITTED, so a person clicking Run agent the instant a failed
-- run armed its retry could mint two queued runs: two `task.agent_turn` jobs,
-- two execs on the same standing session, two settle comments, two review
-- mints. The rule becomes the schema's: a partial unique index over the live
-- statuses. The kick inserts with ON CONFLICT and answers the loser with the
-- winner's run (`reused: true`), exactly what the check-then-act answered
-- when it did see the live run.
--
-- Existing duplicates: per task the NEWEST live run (by seq) is the one the
-- newest-first lanes already treat as current, so it survives; older live
-- twins are closed as `cancelled` with the reason on the row — never deleted,
-- the ledger keeps every run it minted. A cancelled twin's exec, if one is
-- still alive, is reaped by its own next drive window (the orphan check).
-- This one-off backfill writes no `agent.run_settled` audit entry for the
-- twins it closes (the live cancel door does): the reason lives on the row.
--
-- Rolling-deploy safe: the previous image's kick only ever races itself for
-- one task; where it used to mint a twin it now fails that one kick with a
-- unique violation (23505 — not a serialization failure, so the serializable
-- human door does not retry it and answers that rare roll-window race as an
-- error), and its read-committed job logs and drops it (the next tick
-- re-derives). Nothing it reads changes shape.

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY task_id ORDER BY seq DESC) AS rn
  FROM app.project_agent_runs
  WHERE status IN ('queued', 'running')
)
UPDATE app.project_agent_runs r SET
  status = 'cancelled',
  error = 'superseded by a newer live run on the same task (migration 0080)',
  settled_at_ms = (extract(epoch FROM now()) * 1000)::bigint,
  updated_at_ms = (extract(epoch FROM now()) * 1000)::bigint
FROM ranked
WHERE r.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS project_agent_runs_one_live
  ON app.project_agent_runs (task_id)
  WHERE status IN ('queued', 'running');

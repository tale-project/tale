-- One sandbox per worker: every run of a project agent that works at the same
-- time as another works in a workspace of its own (a "worker": `pa-<agent>`,
-- `pa-<agent>-w2`, …, and the same per member's family), so one agent on three
-- tasks no longer piles three processes into one sandbox. The run's turn job
-- CLAIMS its worker before it starts (`domains/tasks/agent-workers.ts`): the
-- claim writes the chosen worker into `session_id` and stamps
-- `session_claimed_at_ms`. A run that cannot start for want of room parks and
-- keeps WHY in `waiting_reason`, so the task, the board and the sandbox page
-- can say what it waits for.

-- When the run took its worker; NULL while it holds none (never claimed, or
-- parked since). Kept on a terminal row as when that run took its worker.
ALTER TABLE app.project_agent_runs
  ADD COLUMN IF NOT EXISTS session_claimed_at_ms bigint;

-- Why a parked run waits: the organization's agent workers are all in use
-- (`org_limit`), the sandbox host is full or short of memory or disk
-- (`host`), an administrator is deleting the workspace it would use
-- (`destroy_pending`), or its sandbox still runs as many processes as it may
-- (`exec_limit`). Read only while the run is parked
-- (`waiting_for_capacity_at_ms IS NOT NULL`); NULL on a park written before
-- this column and on one whose cause has no wording of its own. The inline
-- CHECK is skipped with the column on a re-run, and every existing row is
-- NULL, so it holds from the start.
ALTER TABLE app.project_agent_runs
  ADD COLUMN IF NOT EXISTS waiting_reason text
    CHECK (waiting_reason IN ('org_limit', 'host', 'destroy_pending', 'exec_limit'));

-- One run per worker, as the schema's rule: at most one live run holds a
-- claim on a session. The predicate is the claim's own occupancy rule — a
-- running run, or a queued one that is not parked — so a parked row (whose
-- worker is free for another run) never blocks a claim, even one parked by an
-- image that does not clear the stamp. Session ids are global (they carry the
-- agent's id), so no organization column is needed. No existing row has a
-- claim, so the index applies to a live database; the previous image never
-- writes the stamp, so none of its rows can ever conflict.
CREATE UNIQUE INDEX IF NOT EXISTS project_agent_runs_one_per_worker
  ON app.project_agent_runs (session_id)
  WHERE session_claimed_at_ms IS NOT NULL
    AND (status = 'running'
      OR (status = 'queued' AND waiting_for_capacity_at_ms IS NULL));

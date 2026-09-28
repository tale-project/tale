-- The harness each sandbox agent turn ran on.
--
-- The Harness-turns metrics and the harness-health hint named a turn by its
-- SESSION's `agent_kind` — a stamp written once, when the session row is
-- created. A project agent's session is standing: it is resumed turn after
-- turn, across the agent's harness switches, and it is never re-stamped. So
-- every turn of a session created before the stamp existed read `unknown`,
-- and every turn after a switch (claude-code → pi) kept counting under the
-- harness the session was created with. An automation run whose script
-- node opens the run's session first leaves the stamp NULL for its agent
-- nodes the same way.
--
-- A turn is one op row, and the host that opens it knows the harness it
-- runs: that is where the fact belongs. Every open (the budget reservation,
-- the host's own upsert, the watchdog's claim of a missing row) writes it,
-- and the reads prefer it to the session's stamp, which stays only as the
-- fallback for rows written before this column.
--
-- Backfill: a task-agent op is one project-agent run, whose row records the
-- harness the run was kicked on — the per-turn truth. A workflow-agent op
-- runs in a per-execution session torn down with the run, so its session's
-- stamp is the best record the schema holds (an agent node that opened the
-- session named its harness; a run whose script node opened it has none,
-- and stays `unknown` rather than guessed). Idempotent and bounded: a re-run
-- finds no NULL it can fill. Rolling-deploy safe: a nullable column the
-- previous image neither writes nor reads.

ALTER TABLE app.sandbox_session_ops
  ADD COLUMN IF NOT EXISTS harness text;

UPDATE app.sandbox_session_ops o SET harness = r.harness
FROM app.project_agent_runs r
WHERE o.harness IS NULL
  AND o.kind = 'task-agent'
  AND r.org_id = o.org_id
  AND r.session_id = o.session_id
  AND r.exec_id = o.exec_id;

UPDATE app.sandbox_session_ops o SET harness = s.agent_kind
FROM app.sandbox_sessions s
WHERE o.harness IS NULL
  AND o.kind = 'workflow-agent'
  AND s.org_id = o.org_id
  AND s.session_id = o.session_id
  AND s.owner_type = 'workflow_run'
  AND s.agent_kind IS NOT NULL;

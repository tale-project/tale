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
-- Backfill: task-agent ops have an exact org/session/exec run record. As
-- in the op-attribution resolver, the newest matching run wins when more
-- than one historical row shares that identity. Workflow nodes can choose
-- different harnesses while sharing a session, so its create-time stamp
-- cannot identify a historical node's turn: leave that op NULL rather than
-- promote the read's approximate fallback into an authoritative stamp.
-- Idempotent and bounded: a re-run finds no NULL it can fill. Rolling-deploy
-- safe: a nullable column the previous image neither writes nor reads.

ALTER TABLE app.sandbox_session_ops
  ADD COLUMN IF NOT EXISTS harness text;

UPDATE app.sandbox_session_ops o SET harness = r.harness
FROM (
  SELECT DISTINCT ON (org_id, session_id, exec_id)
         org_id, session_id, exec_id, harness
  FROM app.project_agent_runs
  ORDER BY org_id, session_id, exec_id, seq DESC
) r
WHERE o.harness IS NULL
  AND o.kind = 'task-agent'
  AND r.org_id = o.org_id
  AND r.session_id = o.session_id
  AND r.exec_id = o.exec_id;

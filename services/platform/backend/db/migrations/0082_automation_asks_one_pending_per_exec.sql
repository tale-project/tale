-- One PENDING ask per (session_id, exec_id) — DB-enforced.
--
-- `createAskForExec` (the ask_human tool door) folded a second question from
-- the same agent turn into the turn's pending ask with SELECT-then-INSERT
-- over a plain index (`automation_asks_session`, 0019): two ask_human calls
-- racing inside one turn — an at-least-once tool lane — each saw "no pending
-- row" in READ COMMITTED and both inserted. The run parks on ONE ask; the
-- answered ask retargets the cursor to a fresh exec, after which the second
-- pending row is never read by the poll or the expiry walk and its
-- agent_escalation bells stay unread forever. This file makes the one-row
-- rule one the database cannot forget; the door now folds with a single
-- INSERT … ON CONFLICT (session_id, exec_id) WHERE status = 'pending' DO
-- UPDATE, so N racing askers converge on one row carrying every question.
--
-- Existing duplicates are resolved DETERMINISTICALLY before the index. Per
-- (session_id, exec_id) group the OLDEST pending row — lowest created_at_ms,
-- then id — is the one the run parked on and the one its bells name, so it is
-- kept; the later rows' questions are folded onto it (same separator, same
-- 4000-char cap as the door) so no question is lost, and the phantoms close
-- as `cancelled` (an ask row is history: the answers view reads by run and
-- node, and a cancelled row answers nothing). Each phantom's unread
-- `agent_escalation` bells are marked read in the same statement — the
-- racing loser fanned them out under ITS id, so left alone they would stay
-- unread forever and deep-link to a cancelled ask; this is the contract the
-- run-end door (`closePendingAsksForRun`) keeps for every ask it cancels.
--
-- Rolling-deploy safe: the previous image's SELECT-then-INSERT keeps working
-- for every non-racing ask; the formerly-duplicating race now surfaces as a
-- unique-violation refusal on the loser instead of a silent orphan — the
-- safe side of the trade until the new image takes over.

WITH ranked AS (
  SELECT id, session_id, exec_id, question,
         row_number() OVER (
           PARTITION BY session_id, exec_id
           ORDER BY created_at_ms ASC, id ASC
         ) AS keep_rank
  FROM app.automation_human_asks
  WHERE status = 'pending'
),
folded AS (
  SELECT session_id, exec_id,
         string_agg(question, E'\n\n---\n\n' ORDER BY keep_rank) AS extra
  FROM ranked
  WHERE keep_rank > 1
  GROUP BY session_id, exec_id
)
UPDATE app.automation_human_asks AS a
SET question = left(a.question || E'\n\n---\n\n' || folded.extra, 4000),
    questions = NULL
FROM ranked, folded
WHERE a.id = ranked.id
  AND ranked.keep_rank = 1
  AND folded.session_id = ranked.session_id
  AND folded.exec_id = ranked.exec_id;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY session_id, exec_id
           ORDER BY created_at_ms ASC, id ASC
         ) AS keep_rank
  FROM app.automation_human_asks
  WHERE status = 'pending'
),
phantoms AS (
  UPDATE app.automation_human_asks AS a
  SET status = 'cancelled'
  FROM ranked
  WHERE a.id = ranked.id AND ranked.keep_rank > 1
  RETURNING a.id, a.org_id
)
UPDATE app.user_notifications AS n
SET read = true,
    read_at_ms = (extract(epoch FROM now()) * 1000)::bigint
FROM phantoms
WHERE n.org_id = phantoms.org_id
  AND n.type = 'agent_escalation'
  AND n.read = false
  AND n.params ->> 'askId' = phantoms.id;

CREATE UNIQUE INDEX IF NOT EXISTS automation_asks_pending_exec
  ON app.automation_human_asks (session_id, exec_id)
  WHERE status = 'pending';

-- Direct provider calls hold their worst case on op rows
--
-- A call the platform makes straight to a provider, with no gateway key in
-- between — an automation's `llm` step, a chat title, the Inbox's Improve,
-- voice output, a transcription, an embedding request — holds its worst
-- case against the caps that bind whoever it is for, as a managed turn
-- holds its allowance: on an `app.sandbox_session_ops` row of kind
-- `direct-call` (`backend/domains/governance/direct-calls.ts`), stamped with
-- the subject, its key and its projects. The budget reservations count the
-- row while `spend_settled_at_ms` is NULL — the open-settlement index of
-- 0089 serves that read, so settled rows cost it nothing.
--
-- Two passes of the sandbox watchdog read these rows, each by its own
-- partial index:
--  - a call whose process died never settles: once its `deadline_ms`
--    passes, its hold is released (the row is closed without a booking);
--  - a settled row carries nothing the ledger does not, so a day after the
--    call started it is deleted, oldest first, in batches.
--
-- Rolling-deploy safe: two indexes the previous image never reads; it
-- writes no `direct-call` rows.

CREATE INDEX IF NOT EXISTS sandbox_session_ops_direct_call_open
  ON app.sandbox_session_ops (deadline_ms)
  WHERE kind = 'direct-call' AND spend_settled_at_ms IS NULL;

CREATE INDEX IF NOT EXISTS sandbox_session_ops_direct_call_started
  ON app.sandbox_session_ops (started_at_ms)
  WHERE kind = 'direct-call';

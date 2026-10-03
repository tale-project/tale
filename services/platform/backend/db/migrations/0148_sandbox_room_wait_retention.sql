-- Retention of what waiting for sandbox room leaves behind
-- (backend/domains/sandbox/wait-retention.ts). Every start of an automation
-- step the sandbox refused for want of room settles one op row
-- `awaiting_room`, and a step that waits an hour writes dozens; the sandbox
-- watchdog deletes them an hour after they end, oldest first, keeping each
-- session's newest. Without an index that sweep would scan the whole op
-- table — a row per model-endpoint request — every five minutes; this
-- partial index holds exactly the rows it looks at, in the order it takes
-- them. The sweep writes the predicate as this same literal, so the planner
-- can match it.
CREATE INDEX IF NOT EXISTS sandbox_session_ops_awaiting_room_finished
  ON app.sandbox_session_ops (finished_at_ms)
  WHERE agent_result_status = 'awaiting_room';

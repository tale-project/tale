-- 0.5 app migration 0065: a durable "entered the current delivery state at"
-- stamp for outbound conversation messages, so the send crash-recovery
-- watchdog can find replies stranded 'queued' by a lost or expired send job.
--
-- The row already carries created_at_ms (the original insert) and, in
-- metadata, scheduledSendAt (the undo-window send time) — but a RETRY
-- re-queues the row without touching either, so neither dates the CURRENT
-- 'queued' state, and a watchdog keyed on them would fail a freshly retried
-- send before its job ran. This column is stamped on every delivery_state
-- transition (queued at insert and on retry; sent/failed on settle), giving
-- the sweep a truthful clock.
--
-- Forward-only and rolling-safe: the column is nullable and the watchdog
-- coalesces it to created_at_ms, so the previous image keeps working. The
-- backfill touches only the small in-flight 'queued' set. The partial index
-- keeps the fleet sweep O(queued) on a table that is otherwise all-history.
ALTER TABLE app.conversation_messages
  ADD COLUMN IF NOT EXISTS status_changed_at_ms bigint;

-- In-flight queued rows written before this migration get a truthful stamp so
-- the watchdog neither misses them nor fails them prematurely. (A queued row's
-- sent_at_ms is stamped to the insert instant, so it dates the queue.)
UPDATE app.conversation_messages
  SET status_changed_at_ms = coalesce(sent_at_ms, created_at_ms)
  WHERE delivery_state = 'queued' AND status_changed_at_ms IS NULL;

-- The crash-recovery sweep scans only stuck 'queued' rows fleet-wide; a
-- partial index keeps that O(queued), never a full-table scan.
CREATE INDEX IF NOT EXISTS conversation_messages_stuck_queued
  ON app.conversation_messages (status_changed_at_ms)
  WHERE delivery_state = 'queued';

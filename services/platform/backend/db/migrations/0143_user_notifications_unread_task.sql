-- Unread notification rows by the task they are about.
--
-- A new run on a task answers what its last failed run asked of people: every
-- agent-run kick marks the task's unread `agent_run_failed` rows read
-- (`dismissAgentRunFailedNotifications`), and a moved reviewer designation
-- marks the former designee's unread heads-up on the task read. Both select by
-- `task_id` among a recipient's UNREAD rows, and nothing indexed `task_id`, so
-- each kick — a person's Start, a mention, every automatic retry — scanned the
-- whole notifications table. Unread rows are the small, working part of the
-- table; indexing only them keeps the index small and the kick's dismissal a
-- lookup.
--
-- Rolling-deploy safe: an index; the previous image's statements only get
-- faster.

CREATE INDEX IF NOT EXISTS user_notifications_unread_task
  ON app.user_notifications (task_id)
  WHERE read = false AND task_id IS NOT NULL;

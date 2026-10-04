-- Standing tasks can remain in Backlog or To do while an in-place run works.
-- An automatic retry continues only the same task decision: remembering the
-- status and monotonic activity cursor rejects a move away and back even when
-- timestamps tie or the clock moves backwards. Zero means no decision yet.
-- Nullable together for rolling-deploy writers and existing runs; those runs
-- have no trustworthy snapshot and their in-place retries retire fail-closed.
ALTER TABLE app.project_agent_runs
  ADD COLUMN IF NOT EXISTS in_place_retry_status text
    CHECK (in_place_retry_status IS NULL OR (
      in_place AND in_place_retry_status IN ('backlog', 'todo', 'in_progress')
    )),
  ADD COLUMN IF NOT EXISTS in_place_retry_activity_id bigint
    CONSTRAINT project_agent_runs_in_place_retry_state CHECK (
      (in_place_retry_status IS NULL AND in_place_retry_activity_id IS NULL)
      OR (in_place_retry_status IS NOT NULL
          AND in_place_retry_activity_id IS NOT NULL
          AND in_place_retry_activity_id >= 0)
    );

-- The old job may already have completed after refusing a standing card.
-- Retire only its unsupported pending decision; preserve the arm and history.
-- Old writers can still fail legacy runs during a rolling deploy: the new
-- worker retires those too, and the read model never promises such a retry.
-- This does not cancel a turn an old worker has already started.
WITH retired AS (
  UPDATE app.project_agent_runs
  SET auto_retry_refused_at_ms = (extract(epoch FROM clock_timestamp()) * 1000)::bigint
  WHERE status = 'failed' AND in_place
    AND in_place_retry_status IS NULL AND in_place_retry_activity_id IS NULL
    AND auto_retry_armed_at_ms IS NOT NULL AND auto_retry_refused_at_ms IS NULL
  RETURNING org_id
)
INSERT INTO app_realtime.outbox (org_id, user_id, entity, entity_id)
SELECT DISTINCT org_id, NULL, 'task', NULL FROM retired;

-- Shared by retry guards and review-repair's latest-decision check. Comment
-- traffic does not make finding the last workflow decision scan the timeline.
CREATE INDEX IF NOT EXISTS task_activity_latest_decision
  ON app.task_activity (task_id, id DESC)
  WHERE action IN ('status.changed', 'assignee.changed', 'archived', 'restored', 'review.responded');

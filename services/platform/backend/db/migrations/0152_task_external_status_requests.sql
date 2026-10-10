-- A verified human may request a source-owned transition, including a move
-- that keeps the same board column. The immutable payload and actor survive
-- worker restarts and lost replies; the source's decision is external evidence,
-- never a native Tale review approval. Source revision and task activity sequence
-- bind the form the person actually saw. The previous image ignores this table.
CREATE TABLE IF NOT EXISTS app.task_external_status_requests (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES app.tasks (id) ON DELETE CASCADE,
  org_id text NOT NULL,
  external_system text NOT NULL,
  external_id text NOT NULL,
  -- Canonical submitted body plus authenticated actor; a reused id with a
  -- changed payload is a conflict rather than a second business operation.
  request_hash text NOT NULL,
  actor_id text NOT NULL,
  source_revision text NOT NULL CHECK (length(source_revision) BETWEEN 1 AND 512),
  source_status_at_ms bigint NOT NULL
    CHECK (source_status_at_ms BETWEEN 0 AND 8640000000000000),
  action_id text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled')),
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  -- Activity sequence of the request, even when the desired column is unchanged.
  revision bigint NOT NULL,
  -- Actual status provenance observed by the form, separate from a later
  -- archive/restore activity. The source can distinguish an earlier board
  -- move superseded by this request from a newer independent status intent.
  status_change_id bigint NOT NULL,
  created_at_ms bigint NOT NULL,
  decision jsonb CHECK (decision IS NULL OR jsonb_typeof(decision) = 'object'),
  decided_at_ms bigint
);
CREATE INDEX IF NOT EXISTS task_external_status_requests_org_task
  ON app.task_external_status_requests (org_id, task_id, revision DESC);

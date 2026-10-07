-- A custom external source may project a business decision it already validated.
-- Its receipt separates that evidence from Tale's native review approvals, orders
-- source observations, and prevents a lost reply from replaying over a later board
-- move. Existing intake consumers keep their legacy open/closed policy until this
-- explicit lane writes a receipt. The previous image ignores this additive table.
CREATE TABLE IF NOT EXISTS app.task_external_status (
  task_id text PRIMARY KEY REFERENCES app.tasks (id) ON DELETE CASCADE,
  org_id text NOT NULL,
  external_system text NOT NULL,
  external_id text NOT NULL,
  source_revision text NOT NULL CHECK (length(source_revision) BETWEEN 1 AND 512),
  source_status_at_ms bigint NOT NULL
    CHECK (source_status_at_ms BETWEEN 0 AND 8640000000000000),
  status text NOT NULL
    CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled')),
  archived boolean NOT NULL,
  -- Source-owned form data, bound to this accepted source revision. It is
  -- business record metadata, not organization configuration.
  workflow jsonb,
  -- The task activity sequence after this projection, compared on replay. A
  -- later native status/archive change must be validated at the source first.
  applied_revision bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS task_external_status_org
  ON app.task_external_status (org_id, task_id);

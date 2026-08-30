-- 0.5 app migration 0022: the approvals ledger (0.4 `approvals`) — generic
-- pending/decided rows keyed by (resource_type, resource_id). First tenant:
-- the task review gate (`resource_type = 'task_review'`, resourceId =
-- taskId, run linkage + response in metadata). Workflow-era columns
-- (wf_execution_id, step_slug) carried for imported rows; new mints are
-- workflow-free.

CREATE TABLE app.approvals (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monotonic creation order (the 0.4 _creationTime) for round counting and
  -- newest-first reads.
  seq bigint GENERATED ALWAYS AS IDENTITY,
  org_id text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  priority text NOT NULL DEFAULT 'high',
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'rejected')),
  wf_execution_id text,
  step_slug text,
  approved_by text,
  reviewed_at_ms bigint,
  -- {taskId, projectId, agentSlug, requestedFor, round, question, runId?,
  --  response?: {decision, respondedBy, timestamp, feedback?, ...},
  --  supersededBy?, withdrawn?}
  metadata jsonb,
  created_at_ms bigint NOT NULL
);

CREATE INDEX approvals_resource
  ON app.approvals (resource_type, resource_id, seq DESC);
CREATE INDEX approvals_org_status ON app.approvals (org_id, status);

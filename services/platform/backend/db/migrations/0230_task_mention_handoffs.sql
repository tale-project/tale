-- Handoffs by mention: a comment an agent's run writes that names another
-- agent of the project hands the task to it, once the writing run has ended
-- and no other run holds the task (`backend/domains/tasks/mention-handoffs.ts`).
--
-- A row is one handoff that waits for that moment: the run's end and every
-- run that leaves the task, and the task-agent watchdog after them, take it
-- up, and it is deleted the moment it starts the named agent, is refused or
-- is dropped (its reason lands on the task's timeline). One row per task and
-- named agent: a later comment naming the same agent replaces the earlier
-- one, whose handoff is recorded as dropped.
--
-- The agent, the comment, the asking run and the review are evidence
-- references, not foreign keys: the handoff reads each again before it
-- starts anything, and drops itself when one is gone. The task's deletion
-- deletes its handoffs; the organization's teardown walks `org_id`.
--
-- Rolling-deploy safe: a new table, which the previous image never reads.
-- A comment the previous image saves during the roll hands nothing on, as
-- before.

CREATE TABLE IF NOT EXISTS app.task_mention_handoffs (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL REFERENCES app.tasks (id) ON DELETE CASCADE,
  -- The agent the comment names.
  agent_id text NOT NULL,
  -- The comment: a message of the task's discussion thread.
  message_id text NOT NULL,
  -- The run that wrote it, and its agent.
  author_agent_id text NOT NULL,
  author_run_id text NOT NULL,
  -- The task's pending review the comment found routed to the named agent:
  -- the handoff starts that review, and is dropped once it is decided.
  approval_id text,
  created_at_ms bigint NOT NULL,
  UNIQUE (task_id, agent_id)
);

CREATE INDEX IF NOT EXISTS task_mention_handoffs_author_run
  ON app.task_mention_handoffs (author_run_id);

-- Explicit agent reviewer routing preserves human defaults and captured ownership.
-- Nullable additions leave previous images and existing human reviews unchanged.
-- An agent reference is retained after deletion: an unavailable reviewer must
-- remain an agent-owned wait, never silently fall back to a human creator.
ALTER TABLE app.projects
  ADD COLUMN IF NOT EXISTS default_task_reviewer_agent_id text;
ALTER TABLE app.tasks
  ADD COLUMN IF NOT EXISTS reviewer_agent_id text;

-- A task inherits when both IDs are NULL; otherwise exactly one actor is chosen.
ALTER TABLE app.tasks
  ADD CONSTRAINT tasks_one_reviewer_actor
  CHECK (reviewer_user_id IS NULL OR reviewer_agent_id IS NULL);

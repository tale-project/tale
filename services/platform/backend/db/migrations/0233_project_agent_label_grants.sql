-- The project labels a project agent's `task_set_labels` grant may add to and
-- remove from existing tasks, by name: dispatch gates and label filters match
-- labels by name without regard to case, and the same name names a different
-- label on each board a dispatch serves. A name is stored in the spelling of
-- the agent's project's catalog when it is granted, and stays as stored when
-- that label is renamed or deleted, as a dispatch's label filters do.
--
-- It defaults to no labels, which is what the previous image keeps writing
-- while a deployment rolls: it never names the column, and it offers no tool
-- that reads it.
ALTER TABLE app.project_agents
  ADD COLUMN IF NOT EXISTS label_grants text[] NOT NULL DEFAULT '{}';

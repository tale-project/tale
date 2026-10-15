-- A project agent may work another project's board while that project is a
-- source of its own project's dispatch (`domains/tasks/dispatch-reach.ts`).
-- Its run belongs to the task: `project_id` stays the task's project, whose
-- board, history and audience the run lives in. The agent's own project —
-- whose dispatch put it there, whose instructions it also follows, and whose
-- dispatch a run that ends asks for a pass — is recorded here when the run is
-- kicked.
--
-- NULL on rows written before this column, and on rows the previous image
-- writes while a deployment rolls: those runs' agents are of the task's own
-- project (only this image starts an agent on another board), so readers take
-- `coalesce(agent_project_id, project_id)`.
ALTER TABLE app.project_agent_runs
  ADD COLUMN IF NOT EXISTS agent_project_id text;

-- A task agent's turn was handed its organization's and its agent's
-- instructions, but never its project's: a project that ran a fleet of agents
-- wrote its policy into the project instructions and then told every agent,
-- in every brief, to read them back with task_get before deciding anything,
-- because a conversation's memory of an earlier copy is not the current one.
--
-- Every turn now opens with the project's current instructions beside the
-- agent's, read when the turn starts (`domains/tasks/run-instructions.ts`).
-- What the turn was handed is recorded on its run: the SHA-256 of the
-- project's instructions, of the agent's and of the task's description, the
-- execution that read them and when — so a reader can tell which version of
-- each a run worked from. Null for a run whose turn has not started, and for
-- every run before this migration.
ALTER TABLE app.project_agent_runs
  ADD COLUMN IF NOT EXISTS instructions_snapshot jsonb;

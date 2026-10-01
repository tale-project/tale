-- The organization's standard agent, one per project that needs it.
--
-- A project without agents of its own was a dead end for everyone who cannot
-- set one up (a Member): its tasks could go to a person, never to an agent.
-- The `standard_agent` governance policy (on by default) now gives such a
-- project an agent Tale manages. It is created the first time someone hands
-- work there, configured by the policy rather than by hand, and brought back
-- in line with the policy whenever a run starts
-- (`backend/domains/projects/standard-agent.ts`).
--
--   managed  true for the standard agent Tale created and keeps in line with
--            the policy: its runtime, model and instructions are the policy's,
--            so the Agents tab shows them and nobody edits them there. false
--            for every agent a person set up.
--
-- At most one managed agent per project: the partial unique index makes two
-- people handing work to the same project at the same moment create one
-- agent, not two (the second insert finds the first).
--
-- Rolling-deploy safe: a NOT NULL column with a constant default, and an
-- index over rows only the new image writes. The previous image neither reads
-- nor writes the column, and the agents it creates read as not managed.

ALTER TABLE app.project_agents
  ADD COLUMN IF NOT EXISTS managed boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS project_agents_one_managed
  ON app.project_agents (project_id)
  WHERE managed;

-- The API key a project agent's run was started with
--
-- A run started through the REST API with a key — a task's start, a comment
-- or a review that names the agent, an automation run started with a key
-- whose step puts the agent to work — is the key's spend as well as its
-- starter's: its turns, its images, its connector calls and its searches
-- book to the key and count toward the key's limits. An automation run
-- carries its key (`automation_runs.api_key_id`, 0110); a project agent's run
-- carried none, so every such turn booked without it. An automatic retry and
-- a run another run delegated to continue the run they follow, and carry its
-- key. The billing subject reads it (`domains/sandbox/op-attribution.ts`).
--
-- Rolling-deploy safe: a nullable column the previous image neither writes
-- nor reads.

ALTER TABLE app.project_agent_runs ADD COLUMN IF NOT EXISTS api_key_id text;

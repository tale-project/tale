-- A project agent's own repository credentials and commit identity.
--
-- `connector_credentials` pins, per equipped connector, which of the
-- organization's credentials the agent acts as: a connector slug to the
-- credential's name (`{"forgejo": "Client A"}`). The sandbox credential
-- broker hands an agent's turn the pinned credential instead of the
-- connector's default, so a central agent can reach every repository and a
-- client's agent only its own. A connector it does not name keeps the
-- default. A pin whose credential is gone hands the turn nothing for that
-- connector, never the default (`core/node_only/sandbox/session_credentials.ts`).
--
-- `git_identity` is the `{name, email}` the agent's commits carry when no
-- person owns its workspace (a run the dispatch, a schedule or a person
-- started in the agent's standing workers); NULL for none.
--
-- Both default to "nothing pinned", which is what the previous image keeps
-- writing while a deployment rolls: it never names them, and the broker it
-- runs reads the default credential and no agent identity, as before.
ALTER TABLE app.project_agents
  ADD COLUMN IF NOT EXISTS connector_credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS git_identity jsonb;

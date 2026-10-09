-- An agent's mention handle, and what the agent answered to before it had one.
--
--   handle          What a person types after @ to find the agent: "My Opus
--                   Agent #3" answers to my-opus-agent-3. Made from the
--                   agent's CURRENT name by lib/shared/agent-handle.ts and made
--                   again when the agent is renamed. Unique in its project: a
--                   second agent whose name gives the same handle takes -02,
--                   then -03 and on. A mention stores the agent's id, so the
--                   handle only helps a person type and search. At most 52
--                   characters (AGENT_HANDLE_MAX), lowercase letters and digits
--                   in runs joined by single hyphens.
--   legacy_handles  The handles the agent answered to before handles were
--                   stored: its name with dots for spaces and without spaces,
--                   as the name was when this release first met the agent.
--                   Text written in those days says @research.bot; it keeps
--                   naming this agent after a rename, and that older form wins
--                   over a newer agent's handle (lib/shared/mention-handles.ts).
--                   NULL: not frozen yet. Empty: an agent created since, which
--                   no older text can name.
--
-- Both nullable: the previous image keeps inserting agents without them while
-- a deploy rolls. 0166 fills the agents that exist when it runs, and the next
-- save of any agent of a project fills those the previous image added. The
-- partial unique index is what keeps two agents of a project from sharing a
-- handle when two people save at once.
--
-- Rolling-deploy safe: nullable columns, a CHECK every existing row passes
-- (all NULL), and an index over values only the new image writes. The
-- previous image neither reads nor writes either column.

ALTER TABLE app.project_agents ADD COLUMN IF NOT EXISTS handle text;
ALTER TABLE app.project_agents ADD COLUMN IF NOT EXISTS legacy_handles text[];

ALTER TABLE app.project_agents
  DROP CONSTRAINT IF EXISTS project_agents_handle_shape;
ALTER TABLE app.project_agents
  ADD CONSTRAINT project_agents_handle_shape CHECK (
    handle IS NULL
    OR (char_length(handle) <= 52 AND handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
  );

CREATE UNIQUE INDEX IF NOT EXISTS project_agents_project_handle
  ON app.project_agents (project_id, handle)
  WHERE handle IS NOT NULL;

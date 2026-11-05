-- Who answers in a project chat.
--
-- A chat filed in a project can answer as one of the project's agents —
-- its instructions, its equipped skills and its model — instead of the
-- workspace's chat assistant (`backend/domains/chat/agents.ts`).
--
-- The choice belongs to the conversation: it is kept on the conversation's
-- ROOT thread (the one the person sees; its branches read it from there),
-- beside the skills the conversation uses (`capabilities`). NULL is the
-- assistant. Like a task's agent assignee it is an id without a foreign key:
-- deleting the agent clears it in the same transaction, and a reply ignores
-- an id that names no agent of the chat's own project (one left behind by a
-- project deletion, or a chat moved since), so a stale id answers as the
-- assistant instead of failing the turn.
--
-- A project's new chats — and the chats moved into it — start with its
-- default chat agent: `default_chat_agent_id` when it names one of the
-- project's own agents, else the first agent created in the project (its
-- oldest agent; the Tale-managed standard agent never counts), else the
-- assistant. `chats_start_with_assistant` makes the assistant the default
-- whatever agents the project has. Existing projects read as "the first
-- agent created" (both columns at their defaults); existing chats keep the
-- assistant.
--
-- Rolling-deploy safe: nullable and defaulted columns only; the previous
-- image never reads them.

ALTER TABLE app.thread_metadata
  ADD COLUMN IF NOT EXISTS chat_agent_id text;

-- The agent delete clears the chats that answer as it.
CREATE INDEX IF NOT EXISTS thread_metadata_chat_agent
  ON app.thread_metadata (chat_agent_id)
  WHERE chat_agent_id IS NOT NULL;

ALTER TABLE app.projects
  ADD COLUMN IF NOT EXISTS default_chat_agent_id text,
  ADD COLUMN IF NOT EXISTS chats_start_with_assistant boolean NOT NULL DEFAULT false;

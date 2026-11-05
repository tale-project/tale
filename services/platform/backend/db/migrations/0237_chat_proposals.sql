-- Changes to projects and agents a chat proposed, for the person to apply.
--
-- A chat can draft a change to the workspace — create a project, change a
-- project's name, description, instructions or default chat agent, create
-- an agent, change an agent's name, instructions, model or skills — when
-- the person asks for it (`backend/domains/chat/proposals.ts`). The model
-- writes nothing: its tool checks the change as the person, keeps it here,
-- and the reply shows it as a card. The person applies it (once; the apply
-- checks again, as them, through the same services the pages use) or
-- dismisses it. The row keeps the outcome, so a reload shows what happened.
--
-- One row per proposal, owned by the person whose chat proposed it — the
-- only one who may apply it. It lives and dies with its conversation (the
-- thread's cascade): a chat's trash, retention and erasure take its
-- proposals with it, and the organization's deletion walks it by org_id.
--
-- `payload` is the change as checked when proposed (names resolved to ids,
-- the runtime chosen); `base` is what it changes as it stood then — the
-- card's "before", and what an apply compares against so a change made
-- since is refused rather than overwritten. `result` holds what the apply
-- made (`{ projectId, agentId }`) or why it failed (`{ code, message }`).
--
-- Rolling-deploy safe: a new table nothing older reads.

CREATE TABLE IF NOT EXISTS app.chat_proposals (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  thread_id text NOT NULL REFERENCES app.threads (id) ON DELETE CASCADE,
  user_id text NOT NULL,
  kind text NOT NULL CHECK (
    kind IN ('create_project', 'update_project', 'create_agent', 'update_agent')
  ),
  project_id text,
  agent_id text,
  payload jsonb NOT NULL,
  base jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'applied', 'dismissed', 'failed')
  ),
  result jsonb,
  created_at_ms bigint NOT NULL,
  decided_at_ms bigint
);

CREATE INDEX IF NOT EXISTS chat_proposals_thread
  ON app.chat_proposals (org_id, thread_id, created_at_ms);

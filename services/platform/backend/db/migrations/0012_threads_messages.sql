-- 0.5 app migration 0012: the message store (the @convex-dev/agent
-- component's replacement) + the thread metadata sidecar + the task
-- discussion comment sidecar.
--
-- One generic store serves every message surface: chat threads, task
-- discussions, project discussions. `parts` holds the AI-SDK-shaped content
-- parts (jsonb); `text` is the derived plain content for cheap list reads
-- and search. Ordering is (order, step_order) exactly like the component —
-- one user turn and its assistant/tool steps share an `order`.

CREATE TABLE app.threads (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  user_id text,
  title text,
  summary text,
  -- What this thread carries ('chat' | 'task_discussion' |
  -- 'project_discussion' | …) — open string, mirrors 0.4 kinds.
  kind text,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE INDEX threads_org ON app.threads (org_id, updated_at_ms DESC);
CREATE INDEX threads_org_user ON app.threads (org_id, user_id, updated_at_ms DESC);

CREATE TABLE app.messages (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id text NOT NULL REFERENCES app.threads (id) ON DELETE CASCADE,
  org_id text NOT NULL,
  -- Turn ordering: user turn N and every step it produced share `order`.
  "order" int NOT NULL,
  step_order int NOT NULL DEFAULT 0,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  -- AI-SDK-shaped content parts; NULL for plain-text rows (text carries it).
  parts jsonb,
  -- Derived plain text (list reads, search, discussion bodies).
  text text,
  -- Author identity as saved: Better Auth userId / agent slug / 'system'.
  author_id text,
  status text NOT NULL DEFAULT 'complete'
    CHECK (status IN ('pending', 'complete', 'failed', 'cancelled')),
  usage jsonb,
  error text,
  created_at_ms bigint NOT NULL
);

CREATE INDEX messages_thread_order
  ON app.messages (thread_id, "order", step_order);
CREATE INDEX messages_org ON app.messages (org_id);

-- App-side thread sidecar (0.4 threadMetadata): chat lifecycle + generation
-- state. Complex evolving sub-objects (reasoning state, context summary,
-- auto-route memo) ride jsonb so the chat engine lands without reshapes.
CREATE TABLE app.thread_metadata (
  thread_id text PRIMARY KEY REFERENCES app.threads (id) ON DELETE CASCADE,
  org_id text NOT NULL,
  user_id text NOT NULL,
  chat_type text NOT NULL,
  status text NOT NULL,
  status_changed_at_ms bigint,
  title text,
  generation_status text CHECK (generation_status IN ('generating', 'idle')),
  stream_id text,
  cancelled_at_ms bigint,
  cancelled_message_id text,
  generation_start_ms bigint,
  generation_heartbeat_at_ms bigint,
  generation_queued_since_ms bigint,
  reasoning_state jsonb,
  context_summary jsonb,
  agent_slug text,
  last_auto_route jsonb,
  project_id text,
  voice_output_override boolean,
  created_at_ms bigint NOT NULL
);

CREATE INDEX thread_metadata_org_user
  ON app.thread_metadata (org_id, user_id);
CREATE INDEX thread_metadata_org_project
  ON app.thread_metadata (org_id, project_id);

-- Mutable sidecar for task-discussion comments (the bits the store's rows
-- don't carry: queryable author/mentions, editedAt, locale snapshots).
-- Written in LOCKSTEP with every message.
CREATE TABLE app.task_discussion_message_meta (
  message_id text PRIMARY KEY REFERENCES app.messages (id) ON DELETE CASCADE,
  org_id text NOT NULL,
  thread_id text NOT NULL,
  task_id text NOT NULL REFERENCES app.tasks (id) ON DELETE CASCADE,
  author_type text NOT NULL CHECK (author_type IN ('user', 'agent')),
  author_id text NOT NULL,
  -- [{type: 'user'|'agent'|'automation', id}] — automation mentions are the
  -- run trigger for the owning automation.
  mentions jsonb,
  body_by_locale jsonb,
  created_at_ms bigint NOT NULL,
  edited_at_ms bigint
);

CREATE INDEX task_discussion_meta_task
  ON app.task_discussion_message_meta (task_id, created_at_ms);

-- Tasks gain the discussion thread pointer lazily (first comment mints it);
-- the column already exists (thread_id/discussion_thread_id on app.tasks).

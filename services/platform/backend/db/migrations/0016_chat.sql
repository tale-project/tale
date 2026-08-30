-- 0.5 app migration 0016: the chat streaming + usage substrate.

-- Turn-authored message facts the generic store didn't carry yet.
ALTER TABLE app.messages ADD COLUMN model text;
ALTER TABLE app.messages ADD COLUMN provider_slug text;
ALTER TABLE app.messages ADD COLUMN reasoning text;
ALTER TABLE app.messages ADD COLUMN blocked_reason text;
ALTER TABLE app.messages ADD COLUMN truncation jsonb;

-- One in-flight generation per thread (its absence = the thread is idle —
-- exactly the 0.4 generations contract). The streaming text accumulates
-- here (throttled full-text writes, the 0.4 pattern); NOTIFY nudges API
-- pods to re-read and push over the thread's SSE lane, so a reconnect
-- resumes from the row instead of losing deltas.
CREATE TABLE app.generations (
  thread_id text PRIMARY KEY REFERENCES app.threads (id) ON DELETE CASCADE,
  org_id text NOT NULL,
  message_id text,
  text text NOT NULL DEFAULT '',
  reasoning text NOT NULL DEFAULT '',
  cancel_requested boolean NOT NULL DEFAULT false,
  started_at_ms bigint NOT NULL,
  heartbeat_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE INDEX generations_org ON app.generations (org_id);

-- Per-turn usage ledger (the analytics substrate).
CREATE TABLE app.usage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id text NOT NULL,
  user_id text NOT NULL,
  agent_slug text,
  model text NOT NULL,
  provider text NOT NULL,
  input_tokens int NOT NULL,
  output_tokens int NOT NULL,
  total_tokens int NOT NULL,
  created_at_ms bigint NOT NULL
);

CREATE INDEX usage_events_org_created
  ON app.usage_events (org_id, created_at_ms DESC);

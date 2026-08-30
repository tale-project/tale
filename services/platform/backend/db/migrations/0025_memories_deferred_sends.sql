-- 0.5 app migration 0025: chat memories (approval-gated durable facts) and
-- deferred sends (send-then-wait for attachments).

-- A memory is a proposal until its OWNER approves it — retrieval only ever
-- sees `approved` rows, always scoped to the (org, user) pair.
CREATE TABLE app.memories (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  user_id text NOT NULL,
  content text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  source_thread_id text,
  source_message_id text,
  reviewed_by text,
  reviewed_at_ms bigint,
  created_at_ms bigint NOT NULL
);

CREATE INDEX memories_org_user_status
  ON app.memories (org_id, user_id, status, created_at_ms DESC);

-- A parked send: the composer's Send while media still processes. The row
-- waits until every tracked medium is terminal AND the thread is idle, then
-- claims and runs the turn under the stored identity. `video_job_ids` is
-- carried for the video-links domain; absent rows read as "erased —
-- proceed" (the 0.4 posture).
CREATE TABLE app.deferred_sends (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  user_id text NOT NULL,
  thread_id text NOT NULL REFERENCES app.threads (id) ON DELETE CASCADE,
  user_text text NOT NULL,
  attachments jsonb,
  video_job_ids text[],
  model_id text,
  model_selection text CHECK (model_selection IN ('auto')),
  provider_slug text,
  reasoning_effort text,
  locale text NOT NULL DEFAULT 'en',
  status text NOT NULL CHECK (status IN ('waiting', 'claimed')),
  created_at_ms bigint NOT NULL,
  waiting_since_ms bigint NOT NULL
);

CREATE INDEX deferred_sends_thread
  ON app.deferred_sends (thread_id, created_at_ms);

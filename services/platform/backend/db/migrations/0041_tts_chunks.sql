-- TTS audio chunks (the 0.4 `ttsAudioChunks` table): one row per synthesized
-- sentence/paragraph of an assistant message. The client reserves → the
-- backend calls the provider → the row settles ready (blob ref + billing
-- stamps) or failed (a CLOSED error code — free-form provider text never
-- lands here, it can echo input PII). The (message_id, index) UNIQUE index
-- replaces the 0.4 post-insert dedupe dance (rule 5): two racing reserves
-- now serialize at the constraint.
CREATE TABLE app.tts_audio_chunks (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  thread_id text NOT NULL,
  message_id text NOT NULL,
  user_id text NOT NULL,
  team_id text,
  agent_slug text,
  chunk_index int NOT NULL,
  text text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  error text,
  locale text NOT NULL,
  voice text,
  provider_name text,
  model_id text,
  format text,
  storage_ref text,
  character_count bigint,
  cost_estimate_cents double precision,
  usage_recorded_at_ms bigint,
  created_at_ms bigint NOT NULL,
  attempt_created_at_ms bigint NOT NULL
);

CREATE UNIQUE INDEX tts_audio_chunks_message_index
  ON app.tts_audio_chunks (message_id, chunk_index);
CREATE INDEX tts_audio_chunks_thread_age
  ON app.tts_audio_chunks (thread_id, created_at_ms);
CREATE INDEX tts_audio_chunks_org ON app.tts_audio_chunks (org_id);

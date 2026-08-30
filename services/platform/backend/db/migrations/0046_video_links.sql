-- Video-link ingestion jobs (the 0.4 `videoLinkJobs`): one row per pasted
-- video URL in the chat composer. Kept SEPARATE from `file_metadata` — the
-- row's identity is the URL + pipeline state (no blob exists at insert);
-- the terminal `file_metadata_id` ties it to the row that owns the
-- transcript. The reused orchestrator (`ingest_video_link.ts`) is the
-- single lifecycle owner; `status_changed_at_ms` backs the watchdog.

CREATE TABLE app.video_link_jobs (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  -- Welcome-page pastes have no thread yet; the first send stamps it.
  thread_id text,
  uploaded_by text NOT NULL,
  source_url text NOT NULL,
  -- Deterministic dedup key over the normalized URL (never the raw URL in
  -- logs/audits — tracking/auth params must not leak).
  source_url_hash text NOT NULL,
  source_platform text NOT NULL,
  -- The exact substring captured at paste time (literal strip on send).
  pasted_token text NOT NULL,
  video_title text,
  video_uploader text,
  video_duration_sec double precision,
  video_language text,
  video_chapters jsonb,
  transcript_source text CHECK (transcript_source IN (
    'captions_human', 'captions_auto', 'whisper'
  )),
  caption_track_kind text CHECK (caption_track_kind IN (
    'manual', 'asr', 'auto-translated'
  )),
  caption_lang text,
  status text NOT NULL CHECK (status IN (
    'queued', 'fetching_metadata', 'fetching_captions', 'extracting_audio',
    'transcribing_handoff', 'indexing', 'completed', 'failed', 'skipped'
  )),
  status_changed_at_ms bigint NOT NULL,
  progress text,
  attempts int,
  error_reason_code text,
  error_message text,
  -- Blob ref (`s3:<key>`): transcript blob (captions) or audio (whisper).
  storage_ref text,
  file_metadata_id text,
  lifecycle_status text,
  -- Set when the transcript was attached to a sent message — the bind
  -- dedup key and the composer-visibility cut.
  message_bound_at_ms bigint,
  created_at_ms bigint NOT NULL
);

CREATE INDEX video_link_jobs_thread ON app.video_link_jobs (thread_id);
CREATE INDEX video_link_jobs_org_status
  ON app.video_link_jobs (org_id, status);
CREATE INDEX video_link_jobs_status ON app.video_link_jobs (status);
CREATE INDEX video_link_jobs_org_hash
  ON app.video_link_jobs (org_id, source_url_hash);
CREATE INDEX video_link_jobs_org_user
  ON app.video_link_jobs (org_id, uploaded_by);
CREATE INDEX video_link_jobs_storage_ref
  ON app.video_link_jobs (storage_ref);

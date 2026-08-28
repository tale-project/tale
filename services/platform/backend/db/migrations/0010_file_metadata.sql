-- 0.5 app migration 0010: file metadata (the blob ledger).
--
-- Blobs live in S3-compatible object storage ONLY (Convex `_storage` died
-- with the component): per-org BYO bucket when configured, else the
-- deployment default bucket (the `default` config tree's connection).
-- `storage_ref` keeps the 0.4 `s3:<key>` encoding so blob refs embedded in
-- other rows (task attachments/outputs, documents) stay one vocabulary.
-- RAG / transcription pipeline columns ship now (nullable) so the knowledge
-- and tts domains land without a reshape.

CREATE TABLE app.file_metadata (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  storage_ref text NOT NULL,
  document_id text,
  source text,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size bigint NOT NULL,
  page_count int,
  scanned_pages_detected int,
  vision_required boolean,
  ocr_applied boolean,

  rag_status text CHECK (rag_status IN (
    'queued', 'running', 'completed', 'failed', 'unsupported'
  )),
  rag_error text,
  rag_error_code text,
  rag_progress text,
  rag_queued_at_ms bigint,
  rag_parked boolean,
  skip_rag_indexing boolean,
  rag_indexed_at_ms bigint,

  transcript text,
  transcription_status text CHECK (transcription_status IN (
    'queued', 'running', 'completed', 'failed', 'skipped'
  )),
  transcription_error text,
  transcription_duration_sec double precision,
  transcription_progress text,
  transcription_run_id text,
  transcription_lease_expires_at_ms bigint,
  transcription_started_at_ms bigint,
  transcript_rag_status text CHECK (transcript_rag_status IN (
    'queued', 'running', 'completed', 'failed'
  )),
  transcript_rag_error text,

  content_hash text,
  sha256 text,
  uploaded_by text,
  -- Chat-uploaded files: the thread the file is bound to (scoping + cascade).
  thread_id text,
  lifecycle_status text,
  status_changed_at_ms bigint,
  created_at_ms bigint NOT NULL
);

CREATE INDEX file_metadata_org ON app.file_metadata (org_id);
CREATE INDEX file_metadata_storage_ref ON app.file_metadata (storage_ref);
CREATE INDEX file_metadata_document ON app.file_metadata (document_id);
CREATE INDEX file_metadata_thread ON app.file_metadata (org_id, thread_id);

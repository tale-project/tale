-- 0.5 app migration 0049: controlled-document replacement-upload intents
-- (the 0.4 `controlledDocumentReplacementUploads` ledger). Staging/final are
-- BOTH server-minted org-scoped S3 keys; the final key is written create-only
-- after attestation. Cleanup keeps retry state here until every unbound
-- object is physically gone.
CREATE TABLE app.document_replacement_uploads (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  org_slug text NOT NULL,
  actor_user_id text NOT NULL,
  actor_email text NOT NULL DEFAULT '',
  document_id text NOT NULL,
  expected_record_state text NOT NULL DEFAULT 'draft'
    CHECK (expected_record_state IN ('draft', 'approved')),
  expected_version integer NOT NULL,
  expected_file_id text NOT NULL,
  file_name text NOT NULL,
  client_content_type text,
  last_modified_ms bigint,
  staging_ref text NOT NULL,
  final_ref text NOT NULL,
  state text NOT NULL CHECK (state IN (
    'issued', 'attesting', 'promoted', 'bound', 'failed', 'cancelled',
    'superseded', 'cleaned'
  )),
  upload_expires_at_ms bigint NOT NULL,
  lease_id text,
  lease_expires_at_ms bigint,
  verified_content_type text,
  content_hash text,
  size bigint,
  result_version integer,
  cleanup_pending boolean NOT NULL DEFAULT false,
  cleanup_due_at_ms bigint,
  cleanup_attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE INDEX document_replacement_uploads_document_state
  ON app.document_replacement_uploads (document_id, state);
CREATE INDEX document_replacement_uploads_cleanup
  ON app.document_replacement_uploads (cleanup_pending, cleanup_due_at_ms);

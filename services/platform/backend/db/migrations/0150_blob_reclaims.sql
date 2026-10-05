-- Holder retirement must not lose its only ref on commit/crash or exhausted
-- job retries. These are explicitly retired refs, never a historic bucket scan.
-- Existing rowless ownership needs separate adjudication. No historical
-- backfill runs. The affected-write triggers below also fence old replicas.
-- Refuse the rollout when the previous image already left a user attachment
-- without a file row and without trusted provenance. The old image remains
-- serving because this migration is transactional; a later phased rollout
-- must export/adjudicate those refs before this gate can pass. Guessing from
-- the message author would grant borrowed document refs retention ownership.
-- These locks close the preflight-to-trigger-install race, not just the
-- migrator advisory lock. Waiting old writes resume behind installed triggers.
LOCK TABLE app.file_metadata, app.messages IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app.messages message
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(message.parts) = 'array' THEN message.parts ELSE '[]'::jsonb END
    ) part
    WHERE message.role = 'user'
      AND part->>'type' = 'attachment'
      AND NOT (coalesce(to_jsonb(message)->'attachment_ownership', '{}'::jsonb) ? (part->>'fileId'))
      AND NOT EXISTS (
        SELECT 1 FROM app.file_metadata file
        WHERE file.org_id = message.org_id
          AND file.storage_ref = part->>'fileId'
      )
  ) THEN
    RAISE EXCEPTION 'blob provenance transition blocked: rowless chat attachment needs trusted adjudication';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app.blob_reclaims (
  org_id text NOT NULL,
  storage_ref text NOT NULL,
  next_attempt_at_ms bigint NOT NULL,
  next_dispatch_at_ms bigint NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  last_outcome text,
  created_at_ms bigint NOT NULL,
  custodian_user_ids text[] NOT NULL DEFAULT '{}',
  custody_unknown boolean NOT NULL DEFAULT true,
  PRIMARY KEY (org_id, storage_ref)
);
CREATE INDEX IF NOT EXISTS blob_reclaims_due
  ON app.blob_reclaims (next_attempt_at_ms, org_id, storage_ref);
CREATE INDEX IF NOT EXISTS blob_reclaims_dispatch
  ON app.blob_reclaims (next_dispatch_at_ms, org_id, storage_ref);

-- Undo hands the validated attachments back to one composer, even if the
-- upload row was deleted meanwhile. This grants ownership only until expiry;
-- the corresponding reclaim ledger entry survives and retires the handoff.
CREATE TABLE IF NOT EXISTS app.blob_composer_handoffs (
  org_id text NOT NULL,
  user_id text NOT NULL,
  storage_ref text NOT NULL,
  expires_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, user_id, storage_ref)
);

-- Server-classified attachment binding: owned upload or source document.
-- NULL means legacy/unclassified; classify affected refs before row deletion,
-- not a retrospective scan. Client parts never populate this column.
ALTER TABLE app.messages ADD COLUMN IF NOT EXISTS attachment_ownership jsonb;

-- Native send ownership survives file-row removal. Never populated from
-- mirrored metadata or client attachment parts; old messages remain unknown.
ALTER TABLE app.conversation_messages ADD COLUMN IF NOT EXISTS attachment_owner_user_id text;

-- Same classifier as chatUploadOwned: only trusted upload/thread binding
-- vouches for independent custody. A lossy last-document pointer cannot
-- reconstruct the historical source that authorized a document reader.
CREATE OR REPLACE FUNCTION app.chat_attachment_file_proof(
  file app.file_metadata, thread app.thread_metadata
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN (file).document_id IS NULL AND (
      (file).uploaded_by = (thread).user_id
      OR (file).thread_id = (thread).thread_id
      OR (file).thread_id = (thread).branch_root_id
    ) THEN jsonb_build_object('owned', true)
    WHEN (file).document_id IS NULL THEN jsonb_build_object('fileId', (file).id)
    ELSE jsonb_build_object('sourceAmbiguous', true)
  END
$$;

-- Every OLD image message writer omits the new column. Capture missing
-- proof from locked trusted rows inside that writer transaction; refuse a
-- rowless new/copy write rather than silently losing upload custody.
CREATE OR REPLACE FUNCTION app.capture_chat_message_proof()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ref text;
  proof jsonb;
BEGIN
  IF NEW.role IS DISTINCT FROM 'user' OR jsonb_typeof(NEW.parts) IS DISTINCT FROM 'array' THEN
    RETURN NEW;
  END IF;
  FOR ref IN
    SELECT DISTINCT part->>'fileId'
    FROM jsonb_array_elements(NEW.parts) part
    WHERE part->>'type' = 'attachment' AND part->>'fileId' IS NOT NULL
    ORDER BY part->>'fileId'
  LOOP
    IF coalesce(NEW.attachment_ownership, '{}'::jsonb) ? ref THEN
      CONTINUE;
    END IF;
    WITH locked_files AS MATERIALIZED (
      SELECT file.* FROM app.file_metadata file
      WHERE file.org_id = NEW.org_id AND file.storage_ref = ref
      ORDER BY file.id FOR SHARE OF file NOWAIT
    )
    SELECT app.chat_attachment_file_proof(file::app.file_metadata, thread) INTO proof
    FROM locked_files file JOIN app.thread_metadata thread
      ON thread.org_id = file.org_id AND thread.thread_id = NEW.thread_id
    ORDER BY (app.chat_attachment_file_proof(file::app.file_metadata, thread) @> '{"owned":true}'::jsonb) DESC, file.id
    LIMIT 1;
    IF proof IS NULL THEN
      RAISE EXCEPTION 'chat attachment writer has no trusted file binding' USING ERRCODE = '23514';
    END IF;
    NEW.attachment_ownership := coalesce(NEW.attachment_ownership, '{}'::jsonb)
      || jsonb_build_object(ref, proof);
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS capture_chat_message_proof ON app.messages;
CREATE TRIGGER capture_chat_message_proof
  BEFORE INSERT OR UPDATE OF parts ON app.messages
  FOR EACH ROW EXECUTE FUNCTION app.capture_chat_message_proof();

-- This runs on the OLD image's actual DELETE/rewriting UPDATE, even after
-- the migration ledger was consumed. Its carrying row still exists here.
CREATE OR REPLACE FUNCTION app.capture_chat_file_proof()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
BEGIN
  INSERT INTO app.blob_reclaims (
    org_id, storage_ref, next_attempt_at_ms, next_dispatch_at_ms,
    created_at_ms, custodian_user_ids, custody_unknown
  ) VALUES (
    OLD.org_id, OLD.storage_ref, now_ms, 0, now_ms,
    CASE WHEN OLD.uploaded_by IS NULL THEN '{}'::text[] ELSE ARRAY[OLD.uploaded_by] END,
    OLD.uploaded_by IS NULL
  ) ON CONFLICT (org_id, storage_ref) DO UPDATE SET
    next_attempt_at_ms = least(app.blob_reclaims.next_attempt_at_ms, EXCLUDED.next_attempt_at_ms),
    next_dispatch_at_ms = 0,
    custodian_user_ids = ARRAY(
      SELECT DISTINCT custodian FROM unnest(
        app.blob_reclaims.custodian_user_ids || EXCLUDED.custodian_user_ids
      ) AS custodians(custodian) ORDER BY custodian
    ),
    custody_unknown = app.blob_reclaims.custody_unknown OR EXCLUDED.custody_unknown;
  UPDATE app.messages message SET attachment_ownership =
    coalesce(message.attachment_ownership, '{}'::jsonb)
      || jsonb_build_object(OLD.storage_ref, CASE WHEN EXISTS (
        SELECT 1 FROM app.file_metadata independent
        WHERE independent.org_id = OLD.org_id AND independent.storage_ref = OLD.storage_ref
          AND independent.id <> OLD.id
          AND app.chat_attachment_file_proof(independent, thread) @> '{"owned":true}'::jsonb
      ) THEN jsonb_build_object('owned', true)
      ELSE app.chat_attachment_file_proof(OLD::app.file_metadata, thread) END)
  FROM app.thread_metadata thread
  WHERE message.org_id = OLD.org_id
    AND thread.org_id = message.org_id AND thread.thread_id = message.thread_id
    AND message.role = 'user'
    AND NOT (coalesce(message.attachment_ownership, '{}'::jsonb) ? OLD.storage_ref)
    AND message.parts @> jsonb_build_array(jsonb_build_object('type', 'attachment', 'fileId', OLD.storage_ref));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS capture_chat_file_proof ON app.file_metadata;
CREATE TRIGGER capture_chat_file_proof
  BEFORE DELETE OR UPDATE OF storage_ref, org_id, document_id, uploaded_by, thread_id, lifecycle_status ON app.file_metadata
  FOR EACH ROW EXECUTE FUNCTION app.capture_chat_file_proof();

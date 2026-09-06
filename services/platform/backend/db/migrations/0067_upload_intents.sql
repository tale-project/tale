-- 0.5 app migration 0067: the app upload-intent ledger — the session lanes'
-- twin of the REST door's `rest_upload_intents` (0033).
--
-- Every blob key a session lane mints for a browser (`POST /api/app/files/
-- upload`, `/blob-upload`) is tracked by an intent row
-- keyed on the org, the uploading user, the PURPOSE the key was minted for
-- ('file' | 'skill_bundle' | 'automation_bundle'), and the ref itself. A bind
-- step that later names the ref (`/files/register`, the skill and automation
-- bundle uploads, `/files/reject-blob`) may act on it only by consuming the
-- matching unconsumed, unexpired row; the document bind lane proves the same
-- ownership without consuming (one blob legitimately becomes one document per
-- team).
--
-- Why: `buildObjectKey` mints EVERY org blob as `<prefix>/<orgSlug>/<uuid>`,
-- so the org prefix on a key proves tenancy, never ownership. Without this row
-- any member holding a ref (served to every document reader) could register it
-- as their own upload and delete the shared blob, or hand another document's
-- blob to the skill/automation upload lanes, which delete their staged zip on
-- every path. Consumed/expired rows are swept lazily by the mint path (lazy
-- cleanup over cron, the house rule).

CREATE TABLE IF NOT EXISTS app.upload_intents (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  user_id text NOT NULL,
  -- What the key was minted for. A bind lane consumes only its own purpose,
  -- so a blob staged for a skill bundle can never become a file row and a
  -- registered file can never be fed to the bundle parsers.
  purpose text NOT NULL CHECK (purpose IN ('file', 'skill_bundle', 'automation_bundle')),
  s3_ref text NOT NULL,
  expires_at_ms bigint NOT NULL,
  consumed_at_ms bigint,
  created_at_ms bigint NOT NULL
);

-- One intent per blob ref: keys are random per mint, so a second row for the
-- same ref is a bug upstream, and every consume keys on it.
CREATE UNIQUE INDEX IF NOT EXISTS upload_intents_ref
  ON app.upload_intents (s3_ref);
CREATE INDEX IF NOT EXISTS upload_intents_org_expiry
  ON app.upload_intents (org_id, expires_at_ms);

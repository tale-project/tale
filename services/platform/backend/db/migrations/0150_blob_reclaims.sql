-- Holder retirement must not lose its only ref on commit/crash or exhausted
-- job retries. These are explicitly retired refs, never a historic bucket scan.
-- Additive schema compatibility only; legacy rowless ownership needs a
-- separate rollout disposition before release. No existing data is rewritten.
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

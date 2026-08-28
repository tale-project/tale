-- 0.5 app migration 0035: connector credentials — org-owned, MULTIPLE per
-- connector (the 0.4 `connectorCredentials` table). Secret material lives in
-- one AES-256-GCM envelope (`lib/secret_box`) so adding an auth method never
-- reshapes the table; listings serve the write-time masked preview and never
-- touch ciphertext. At most one DEFAULT per (org, connector); name uniqueness
-- is case-insensitive within the pair.

CREATE TABLE app.connector_credentials (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  connector_slug text NOT NULL,
  auth_method text NOT NULL CHECK (auth_method IN (
    'api-key', 'bearer', 'basic', 'oauth2'
  )),
  name text NOT NULL,
  -- lib/secret_box EncryptedSecret {ciphertext, nonce, authTag, keyFingerprint}
  encrypted_data jsonb NOT NULL,
  endpoint_url text,
  config jsonb,
  masked_preview text,
  is_default boolean NOT NULL DEFAULT false,
  -- Per-credential mail-sync watermarks (epoch ms) — every active mailbox on
  -- a connector keeps its own cursor.
  mail_sync_inbound_since_ms bigint,
  mail_sync_outbound_since_ms bigint,
  status text NOT NULL CHECK (status IN ('active', 'disabled', 'needs-reauth')),
  status_detail text,
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE INDEX connector_credentials_org
  ON app.connector_credentials (org_id);
CREATE INDEX connector_credentials_org_connector
  ON app.connector_credentials (org_id, connector_slug);
-- Case-insensitive label uniqueness within (org, connector).
CREATE UNIQUE INDEX connector_credentials_org_connector_name
  ON app.connector_credentials (org_id, connector_slug, lower(name));
-- At most one default per (org, connector).
CREATE UNIQUE INDEX connector_credentials_one_default
  ON app.connector_credentials (org_id, connector_slug)
  WHERE is_default;

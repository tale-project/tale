-- 0.5 app migration 0015: AI-provider credentials.
--
-- Org-owned, multiple per provider, discriminated by auth_method. Secret
-- material is AES-256-GCM ciphertext (lib/secret_box, keyed by
-- ENCRYPTION_SECRET_HEX with a key fingerprint for rotation detection);
-- `env` rows store only the TALE_PROVIDER_KEY_-gated variable NAME.
-- At most one default per (org, provider) — a partial unique index replaces
-- the 0.4 walk-and-clear (the swap still clears siblings in-transaction).

CREATE TABLE app.provider_credentials (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  provider_slug text NOT NULL,
  auth_method text NOT NULL CHECK (auth_method IN (
    'api-key', 'env', 'subscription-key', 'subscription-broker'
  )),
  name text NOT NULL,
  -- {ciphertext, nonce, authTag, keyFingerprint} — lib/secret_box shape.
  encrypted_data jsonb,
  env_name text,
  endpoint_url text,
  masked_preview text,
  model_allowlist text[],
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  UNIQUE (org_id, provider_slug, name)
);

CREATE INDEX provider_credentials_org ON app.provider_credentials (org_id);
CREATE INDEX provider_credentials_org_provider
  ON app.provider_credentials (org_id, provider_slug);
CREATE UNIQUE INDEX provider_credentials_one_default
  ON app.provider_credentials (org_id, provider_slug)
  WHERE is_default;

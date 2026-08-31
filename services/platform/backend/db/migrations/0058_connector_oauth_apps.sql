-- Org-level connector OAuth apps: the org's OWN registration with a vendor
-- (client id + secret), configured in Settings > Connectors by an org
-- admin. Resolution is org row first, deployment env second
-- (CONNECTOR_OAUTH_<SLUG>_* / CLOUD_IMPORT_*), so a multi-org deployment
-- no longer forces every org through one shared vendor app — restoring the
-- org-level capability the pre-#2857 integrations system had.
--
-- The row is keyed by the OAuth surface's slug: a connector slug
-- ('google-drive', 'gmail', 'outlook', 'teams', 'discord') or the Knowledge
-- cloud-import provider 'onedrive'. 'google-drive' deliberately serves BOTH
-- the connector lane and Knowledge cloud-import — one vendor app with two
-- registered redirect URIs. 'slack' is excluded for now: its inbound Events
-- signature check runs before any org is known, so a per-org Slack app
-- would OAuth but never verify events.
CREATE TABLE app.connector_oauth_apps (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  slug text NOT NULL,
  -- The vendor-issued application (client) id. Not a secret.
  client_id text NOT NULL,
  -- lib/secret_box EncryptedSecret {ciphertext, nonce, authTag,
  -- keyFingerprint} carrying the client secret; listings serve
  -- masked_preview and never touch ciphertext.
  encrypted_data jsonb NOT NULL,
  -- Provider-specific non-secret extras. Today: {"tenantId": "..."} for
  -- Microsoft-family apps — a single-tenant registration rejects the
  -- catalog's /common authorize URL with AADSTS50194.
  config jsonb,
  -- first4…last2 excerpt of the client secret, absent when the secret is
  -- too short to excerpt safely (masking.ts doctrine).
  masked_preview text,
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

-- One app per (org, surface): the resolution rule the code depends on —
-- upserts land on this key.
CREATE UNIQUE INDEX connector_oauth_apps_org_slug
  ON app.connector_oauth_apps (org_id, slug);

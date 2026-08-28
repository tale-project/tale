-- Cloud-import per-user OAuth grants (the 0.4 `userCloudAuthorizations` +
-- `cloudImportOauthStates`): one sealed OAuth2 payload per
-- (org, user, provider), intentional Documents-import grants — never an
-- org-wide connector credential and never agent-resolvable. States mirror
-- the connector OAuth pattern: opaque hashed state, PKCE verifier held
-- server-side, one-shot consume with a TTL.

CREATE TABLE app.user_cloud_authorizations (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  user_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('onedrive', 'google-drive')),
  -- `lib/secret_box` envelope over `{accessToken, refreshToken?, expiresAt?,
  -- scopes?}` — the same seal connector credentials use.
  encrypted_data jsonb NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  account_label text,
  status text NOT NULL
    CHECK (status IN ('active', 'needs-reauth', 'revoked')),
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  UNIQUE (org_id, user_id, provider)
);

CREATE INDEX user_cloud_authorizations_user
  ON app.user_cloud_authorizations (user_id);

CREATE TABLE app.cloud_import_oauth_states (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  org_id text NOT NULL,
  user_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('onedrive', 'google-drive')),
  code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  created_at_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL
);

CREATE INDEX cloud_import_oauth_states_expiry
  ON app.cloud_import_oauth_states (expires_at_ms);

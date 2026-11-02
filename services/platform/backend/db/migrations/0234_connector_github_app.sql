-- Connector credentials may be the organization's own GitHub App
--
-- A `github-app` credential holds an app an organization admin registered
-- on GitHub from Tale's connector settings (GitHub's manifest flow), and the
-- installation that admin chose repositories for. Its private key is sealed
-- in the same `encrypted_data` envelope as every other method's secret; the
-- app's public identity and its installation are the `client_app` copy 0217
-- added. The method list the CHECK accepts grows (the inline check 0035
-- created, under Postgres's default name).
--
-- `app.connector_github_app_states` holds the browser round trips to GitHub
-- that are in flight, one row per state token handed to GitHub, stored as
-- its SHA-256 the way `app.connector_oauth_states` (0055) stores a consent's:
--   * `register` — the admin's browser posted the manifest; GitHub sends it
--     back with a code that buys the new app's private key. The row carries
--     what the credential is created with (`config`: connector, credential
--     name, app name, GitHub owner), so nothing in the return request can
--     choose them, and there is no credential yet.
--   * `install` — the admin was sent to install the app a credential holds,
--     or to change its repositories. The row names that credential and goes
--     with it: a credential deleted meanwhile leaves no row to complete.
-- A row is claimed once (`DELETE … RETURNING`, one statement, so two
-- replayed returns cannot both observe it), by the member who began it, and
-- expires after a few minutes. Each new row sweeps a bounded page of expired
-- ones, so the table stays small without a cron (a registration abandoned on
-- GitHub's page is never claimed).
--
-- Rolling-deploy safe: every existing row already satisfies the wider check,
-- the table is new, and the previous image neither writes the new method nor
-- reads the table.

ALTER TABLE app.connector_credentials
  DROP CONSTRAINT IF EXISTS connector_credentials_auth_method_check;

ALTER TABLE app.connector_credentials
  ADD CONSTRAINT connector_credentials_auth_method_check CHECK (auth_method IN (
    'api-key', 'bearer', 'basic', 'oauth2', 'client-credentials', 'github-app'
  ));

CREATE TABLE IF NOT EXISTS app.connector_github_app_states (
  state_hash text PRIMARY KEY,
  flow text NOT NULL CHECK (flow IN ('register', 'install')),
  org_id text NOT NULL,
  user_id text NOT NULL,
  credential_id text
    REFERENCES app.connector_credentials (id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL,
  -- An installation completes onto one credential; a registration creates it.
  CONSTRAINT connector_github_app_states_flow_credential
    CHECK ((flow = 'install') = (credential_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS connector_github_app_states_expires
  ON app.connector_github_app_states (expires_at_ms);

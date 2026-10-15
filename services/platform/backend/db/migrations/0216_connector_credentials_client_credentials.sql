-- Connector credentials may sign in as the organization's own app
--
-- A `client-credentials` credential holds an app registration (directory,
-- client ID, client secret) that signs in as itself — no person, no consent
-- screen — and the access token the platform last fetched with it, all in
-- the same `encrypted_data` envelope as every other method. Outlook uses it
-- to reach a shared mailbox the app is scoped to by Exchange RBAC for
-- Applications. The table needs no new column; only the method list the
-- CHECK accepts grows (the inline check 0035 created, under Postgres's
-- default name).
--
-- Rolling-deploy safe: every existing row already satisfies the wider check,
-- and the previous image never writes the new method.

ALTER TABLE app.connector_credentials
  DROP CONSTRAINT IF EXISTS connector_credentials_auth_method_check;

ALTER TABLE app.connector_credentials
  ADD CONSTRAINT connector_credentials_auth_method_check CHECK (auth_method IN (
    'api-key', 'bearer', 'basic', 'oauth2', 'client-credentials'
  ));

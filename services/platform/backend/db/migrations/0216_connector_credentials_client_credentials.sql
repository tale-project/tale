-- Connector credentials may sign in as the organization's own app
--
-- A `client-credentials` credential holds an app registration (directory,
-- client ID, client secret) that signs in as itself — no person, no consent
-- screen — and the access token the platform last fetched with it, all in
-- the same `encrypted_data` envelope as every other method. Outlook uses it
-- to reach a shared mailbox the app is scoped to by Exchange RBAC for
-- Applications. The method list the CHECK accepts grows (the inline check
-- 0035 created, under Postgres's default name).
--
-- `client_app` shows which app such a credential signs in as:
-- `{ "tenantId"?, "clientId" }`, the registration's directory and
-- application ID. Neither is secret — the client secret stays sealed — and
-- an admin needs both to tell which app a credential uses, which is what
-- its refusal tells them to check. It is a copy of the envelope's two
-- values, written from the same payload in the same statement whenever the
-- secret is set; NULL for every other method.
--
-- Rolling-deploy safe: every existing row already satisfies the wider check,
-- the new column is nullable, and the previous image neither writes the new
-- method nor reads the column.

ALTER TABLE app.connector_credentials
  DROP CONSTRAINT IF EXISTS connector_credentials_auth_method_check;

ALTER TABLE app.connector_credentials
  ADD CONSTRAINT connector_credentials_auth_method_check CHECK (auth_method IN (
    'api-key', 'bearer', 'basic', 'oauth2', 'client-credentials'
  ));

ALTER TABLE app.connector_credentials
  ADD COLUMN IF NOT EXISTS client_app jsonb;

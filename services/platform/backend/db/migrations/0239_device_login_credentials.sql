-- Provider credentials may sign in on a sandbox device
--
-- A `device-login` credential holds NO secret: it turns one provider run on
-- a connected sandbox device, which serves the turn with the harness sign-in
-- it holds itself (`tale sandbox login claude-code`). The token never reaches
-- the platform, so the row stores nothing in `encrypted_data`, `env_name` or
-- `endpoint_url`. The method list the CHECK accepts grows (the inline check
-- 0015 created, under Postgres's default name).
--
-- Rolling-deploy safe: every existing row already satisfies the wider check,
-- and the previous image never writes the new method.

ALTER TABLE app.provider_credentials
  DROP CONSTRAINT IF EXISTS provider_credentials_auth_method_check;

ALTER TABLE app.provider_credentials
  ADD CONSTRAINT provider_credentials_auth_method_check CHECK (auth_method IN (
    'api-key', 'env', 'subscription-key', 'subscription-broker', 'device-login'
  ));

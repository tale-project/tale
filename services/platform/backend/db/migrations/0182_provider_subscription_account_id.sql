-- 0.5 app migration 0182: vendor account identity for static subscriptions.
ALTER TABLE app.provider_credentials
  ADD COLUMN IF NOT EXISTS account_id text;

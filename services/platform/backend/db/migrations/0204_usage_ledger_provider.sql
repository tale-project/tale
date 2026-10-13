-- Model IDs are provider-local. New writes need provider in the bucket key,
-- but replacing the parent index would break the previous image's ON CONFLICT
-- target during a rolling deploy. Inheritance keeps that target intact while
-- all existing ledger SELECTs and DELETEs include the provider-aware rows.
-- Parent rows stay byte-preserved: previously merged spend cannot be split
-- without the original request attribution. Old images still book parent rows.

CREATE TABLE IF NOT EXISTS app.usage_ledger_provider (
  PRIMARY KEY (id)
) INHERITS (app.usage_ledger);

-- Indexes are not inherited. NULL dimensions retain the parent's keyless
-- bucket semantics, but known and unknown providers never merge.
CREATE UNIQUE INDEX IF NOT EXISTS usage_ledger_provider_bucket
  ON app.usage_ledger_provider (
    org_id, user_id, period_key,
    coalesce(team_id, ''), coalesce(agent_slug, ''), coalesce(model, ''),
    coalesce(provider, ''), coalesce(api_key_id, ''),
    coalesce(connector_name, ''), coalesce(connector_operation, '')
  );

CREATE INDEX IF NOT EXISTS usage_ledger_provider_org_period
  ON app.usage_ledger_provider (org_id, period_key);

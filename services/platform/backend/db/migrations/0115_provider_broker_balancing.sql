-- Share subscription account rotation and rate-limit cooldown across workers
--
-- A process-local cursor restarts on every worker and races concurrent jobs.
-- Locking and incrementing this sequence serializes account selections for
-- one credential. It is runtime bookkeeping, not an admin configuration edit:
-- neither updated_at_ms nor the credential's configuration hash changes.
-- Additive/defaulted so the previous image continues serving during rollout.
ALTER TABLE app.provider_credentials
  ADD COLUMN broker_selection_sequence bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT provider_credentials_org_identity UNIQUE (org_id, id);

CREATE TABLE app.provider_broker_accounts (
  org_id text NOT NULL,
  credential_id text NOT NULL,
  -- SHA256 of credential + broker account id (token hash for legacy brokers).
  -- No token, email or vendor account identifier belongs in this table.
  account_hash text NOT NULL CHECK (account_hash ~ '^[0-9a-f]{64}$'),
  last_selected_sequence bigint NOT NULL CHECK (last_selected_sequence > 0),
  cooldown_until_ms bigint NOT NULL DEFAULT 0,
  updated_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, credential_id, account_hash),
  FOREIGN KEY (org_id, credential_id)
    REFERENCES app.provider_credentials (org_id, id) ON DELETE CASCADE
);

-- Run settlement knows the tenant and stamped account hash, not secret data.
CREATE INDEX provider_broker_accounts_failure
  ON app.provider_broker_accounts (org_id, account_hash);

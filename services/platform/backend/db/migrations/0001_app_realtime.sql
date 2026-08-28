-- 0.5 app migration 0001: the Tier-2 realtime hint outbox.
-- Applied at boot by backend/db/migrate.ts (advisory-lock guarded, tracked in
-- app_migrations). Statements must be idempotent-safe under reruns only via
-- the tracking table — write plain DDL here, the migrator applies each file
-- exactly once inside a transaction.

CREATE SCHEMA app_realtime;

CREATE TABLE app_realtime.outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbox_org_id_id ON app_realtime.outbox (org_id, id);

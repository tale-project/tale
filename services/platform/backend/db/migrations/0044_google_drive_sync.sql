-- Google Drive sync configs (the 0.4 `googleDriveSyncConfigs`) — the same
-- substrate as OneDrive's (0043): one row per synced Drive selection, the
-- pg-boss scan enqueues one reconcile job per syncable config, imported
-- documents point back via metadata.syncConfigId.

CREATE TABLE app.google_drive_sync_configs (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  -- Config owner: the member whose cloud-import grant the sync runs under.
  user_id text NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('file', 'folder')),
  item_id text NOT NULL,
  item_name text NOT NULL,
  item_path text,
  target_bucket text NOT NULL,
  storage_prefix text,
  team_id text,
  status text NOT NULL CHECK (status IN ('active', 'inactive', 'error')),
  last_sync_at_ms bigint,
  last_sync_status text,
  error_message text,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  -- One config per synced source item (0.4 upsert reactivates in place).
  UNIQUE (org_id, item_id)
);

CREATE INDEX google_drive_sync_configs_org_status
  ON app.google_drive_sync_configs (org_id, status);

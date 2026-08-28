-- OneDrive sync configs (the 0.4 `onedriveSyncConfigs`): one row per synced
-- personal-OneDrive selection ("Sync import" of a folder or a directly
-- selected file). The pg-boss scan enqueues one reconcile job per active
-- config; imported documents point back via metadata.syncConfigId — the link
-- the engine uses to update and prune them on later runs.

CREATE TABLE app.onedrive_sync_configs (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  -- Config owner: the member whose Microsoft grant the sync runs under.
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

CREATE INDEX onedrive_sync_configs_org_status
  ON app.onedrive_sync_configs (org_id, status);

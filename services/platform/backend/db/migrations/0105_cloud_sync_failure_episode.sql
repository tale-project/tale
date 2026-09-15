-- A cloud-sync config remembers its current FAILURE EPISODE, so a broken
-- sync can be surfaced once and cleared when it recovers.
--
-- The OneDrive / Google Drive folder-sync engine (`domains/onedrive/service.ts`,
-- `runSyncConfigJobWith`) stamps `status = 'error'` + `error_message` on every
-- failed run and the 15-minute scan retries `error` configs forever. Nothing
-- said WHEN the failing began or whether anyone had been told: the hub folder
-- listing decorated only `active` configs, so an errored sync's folder simply
-- lost its "(synced)" label and looked like a plain folder, and a dead grant
-- (the owner's Microsoft/Google refresh token revoked → `needs-reauth`) left
-- the mirror silently frozen at its last good run (2026-09-15).
--
-- `error_since_ms`: the first failed run of the CURRENT episode; NULL while
-- the config is healthy. A run that fails keeps an existing value, a run that
-- succeeds clears it — the episode ends only with a successful sync, so a
-- re-import ("Sync import" on the same item, which reactivates the row) does
-- not reset it either.
--
-- `failure_notified_at_ms`: when the config owner was told about this episode
-- (one `cloud_sync_failed` bell row + actionable email per episode: at once for
-- a dead grant, after the episode is an hour old for anything else); NULL when
-- nobody has been told yet, cleared with the episode.
--
-- Both nullable, no backfill: a config already sitting in `error` when this
-- ships opens its episode on its next failed run. Rolling-deploy safe: the
-- previous image neither reads nor writes either column, and every write to
-- these tables names its columns explicitly.

ALTER TABLE app.onedrive_sync_configs
  ADD COLUMN IF NOT EXISTS error_since_ms bigint,
  ADD COLUMN IF NOT EXISTS failure_notified_at_ms bigint;

ALTER TABLE app.google_drive_sync_configs
  ADD COLUMN IF NOT EXISTS error_since_ms bigint,
  ADD COLUMN IF NOT EXISTS failure_notified_at_ms bigint;

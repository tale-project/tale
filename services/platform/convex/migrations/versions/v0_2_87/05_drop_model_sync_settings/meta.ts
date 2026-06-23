import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.87 / 05 — drop the legacy `modelSyncSettings` rows now that 03 exported
 * them to per-org `model-sync.json` files.
 *
 * Contract step (DESTRUCTIVE): each row is snapshotted into `migrationSnapshots`
 * before deletion, so `down` (the generic snapshot-restore) rebuilds the table.
 * Gated behind explicit operator acceptance in the CLI.
 */
export const meta: MigrationMeta = {
  id: '0.2.87/05_drop_model_sync_settings',
  semver: '0.2.87',
  numericId: 5,
  slug: 'drop_model_sync_settings',
  title: 'Drop the legacy modelSyncSettings rows (post-export cleanup)',
  description:
    'Deletes every legacy modelSyncSettings row after snapshotting it. The ' +
    'model-sync.json files written by 0.2.87/03 are the source of truth from ' +
    'here on. down restores the rows from the snapshot. Run only after ' +
    'verifying the exported model_sync policy files look correct.',
  kind: 'db',
  reversible: true,
  destructive: true,
  snapshot: 'table-rows',
};

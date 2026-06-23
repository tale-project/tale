import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.87 / 03 — export the DB-backed `modelSyncSettings` row to the file-based
 * `model_sync` governance policy.
 *
 * Expand step of the model-sync cutover: for each org with a legacy
 * `modelSyncSettings` row, writes `<org>/governance/model-sync.json` (the new
 * source of truth) and re-syncs the configCache mirror. Non-destructive — the
 * legacy rows are dropped later by 0.2.87/05. A per-org fs-tree snapshot of the
 * governance directory is taken first so `down` can restore the prior files.
 * Idempotent (re-running overwrites the same file).
 */
export const meta: MigrationMeta = {
  id: '0.2.87/03_model_sync_db_to_json',
  semver: '0.2.87',
  numericId: 3,
  slug: 'model_sync_db_to_json',
  title:
    'Export modelSyncSettings to the file-based model_sync governance policy',
  description:
    'For each org with a legacy modelSyncSettings row, writes its ' +
    'model-sync.json (autoSyncEnabled) under <org>/governance/, then re-syncs ' +
    'the configCache mirror. Non-destructive to the database — the legacy rows ' +
    'are dropped by 0.2.87/05. A per-org fs-tree snapshot of the governance ' +
    'directory is taken first so down can restore the prior files.',
  kind: 'node',
  reversible: true,
  destructive: false,
  snapshot: 'fs-tree',
};

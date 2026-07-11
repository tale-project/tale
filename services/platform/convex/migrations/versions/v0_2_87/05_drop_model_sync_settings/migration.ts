/**
 * 0.2.87 / 05 — drop the legacy `modelSyncSettings` rows now that 03 exported
 * them to per-org `model-sync.json` files.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` (so it can be rebuilt) and deletes it, so `down` (the
 * framework's generic snapshot-restore) rebuilds the table. Gated behind
 * explicit operator acceptance in the CLI. The runner dispatches
 * `restoreSnapshotBatch` for `table-rows` migrations and never calls the
 * `down` defined here, which is therefore a documented no-op.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the legacy modelSyncSettings rows (post-export cleanup)',
  description:
    'Deletes every legacy modelSyncSettings row after snapshotting it. The ' +
    'model-sync.json files written by 0.2.87/03 are the source of truth from ' +
    'here on. down restores the rows from the snapshot. Run only after ' +
    'verifying the exported model_sync policy files look correct.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['modelSyncSettings'] },
  table: 'modelSyncSettings',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:modelSyncSettings', doc);
    // Legacy table absent from the schema → delete untyped.
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
    await (ctx.db as any).delete(doc._id);
  },

  // Unused: `table-rows` rollback is the generic snapshot-restore in the runner.
  // Kept to satisfy the DbMigration contract.
  async down() {
    /* no-op — see restoreSnapshotBatch */
  },
});

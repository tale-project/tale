/**
 * 0.4.0 / 14 — drop the retired `wfWebhooks` rows.
 *
 * Workflow webhook triggers are rebuilt; the per-workflow webhook tokens this
 * table held have no reader or writer.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired wfWebhooks rows',
  description:
    'Deletes every wfWebhooks row after snapshotting it: workflow webhook triggers are rebuilt and no reader remains. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['wfWebhooks'] },
  table: 'wfWebhooks',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:wfWebhooks', doc);
    // Legacy table absent from the schema → delete untyped.
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
    await (ctx.db as any).delete(doc._id);
  },

  // Unused: `table-rows` rollback is the generic snapshot-restore in the
  // runner. Kept to satisfy the DbMigration contract.
  async down() {
    /* no-op — see restoreSnapshotBatch */
  },
});

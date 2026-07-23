/**
 * 0.4.0 / 20 — drop the retired `chatMessageQueue` rows.
 *
 * The mid-turn "keep typing while it works" message queue is rebuilt; the
 * queued/claimed/delivered message rows this table held have no reader or writer.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired chatMessageQueue rows',
  description:
    'Deletes every chatMessageQueue row after snapshotting it: the mid-turn chat message queue is rebuilt and no reader remains. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['chatMessageQueue'] },
  table: 'chatMessageQueue',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:chatMessageQueue', doc);
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

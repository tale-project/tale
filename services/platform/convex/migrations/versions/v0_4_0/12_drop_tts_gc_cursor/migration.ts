/**
 * 0.4.0 / 12 — drop the retired `ttsGcCursor` rows.
 *
 * Voice output and its garbage-collection cron are retired; the singleton
 * cursor that advanced the cron through the org list has no reader.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired ttsGcCursor rows',
  description:
    'Deletes every ttsGcCursor row after snapshotting it: the TTS garbage-collection cron cursor is retired with voice output, so no reader remains. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['ttsGcCursor'] },
  table: 'ttsGcCursor',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:ttsGcCursor', doc);
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

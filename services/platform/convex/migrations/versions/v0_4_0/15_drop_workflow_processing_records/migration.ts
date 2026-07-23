/**
 * 0.4.0 / 15 — drop the retired `workflowProcessingRecords` rows.
 *
 * The event-workflow record-processing ledger (dedupe of already-processed
 * table records) is retired with the workflow engine and has no reader.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired workflowProcessingRecords rows',
  description:
    'Deletes every workflowProcessingRecords row after snapshotting it: the workflow record-processing ledger is retired and nothing reads it. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['workflowProcessingRecords'] },
  table: 'workflowProcessingRecords',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:workflowProcessingRecords', doc);
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

/**
 * 0.4.0 / 21 — drop the retired `externalRuns` rows.
 *
 * External agent runs (task work dispatched to a daemon runtime) are rebuilt;
 * the frozen-prompt run records this table held have no reader or writer.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired externalRuns rows',
  description:
    'Deletes every externalRuns row after snapshotting it: external agent runs are rebuilt without this table and nothing reads it. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['externalRuns'] },
  table: 'externalRuns',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:externalRuns', doc);
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

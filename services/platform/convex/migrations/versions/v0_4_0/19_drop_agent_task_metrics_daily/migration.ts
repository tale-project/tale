/**
 * 0.4.0 / 19 — drop the retired `agentTaskMetricsDaily` rows.
 *
 * Per-agent daily metric rollups are rebuilt; the aggregate rows this table
 * held are recomputed elsewhere and have no reader here.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired agentTaskMetricsDaily rows',
  description:
    'Deletes every agentTaskMetricsDaily row after snapshotting it: per-agent daily metric rollups are rebuilt and nothing reads this table. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['agentTaskMetricsDaily'] },
  table: 'agentTaskMetricsDaily',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:agentTaskMetricsDaily', doc);
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

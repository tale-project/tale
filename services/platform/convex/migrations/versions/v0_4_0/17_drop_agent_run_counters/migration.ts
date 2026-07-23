/**
 * 0.4.0 / 17 — drop the retired `agentRunCounters` rows.
 *
 * Agent concurrency accounting is rebuilt; the OCC-serialized per-scope running
 * counters this table held have no reader or writer.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired agentRunCounters rows',
  description:
    'Deletes every agentRunCounters row after snapshotting it: agent concurrency accounting is rebuilt and nothing reads this table. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['agentRunCounters'] },
  table: 'agentRunCounters',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:agentRunCounters', doc);
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

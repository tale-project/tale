/**
 * 0.4.0 / 16 — drop the retired `agentDefaultProvisions` rows.
 *
 * Agent auto-provisioning is rebuilt without a per-(org, agent) provision
 * ledger, so these once-handled markers have no reader.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired agentDefaultProvisions rows',
  description:
    'Deletes every agentDefaultProvisions row after snapshotting it: agent auto-provisioning is rebuilt without this ledger, so no reader remains. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['agentDefaultProvisions'] },
  table: 'agentDefaultProvisions',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:agentDefaultProvisions', doc);
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

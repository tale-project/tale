/**
 * 0.4.0 / 05 — drop the retired `modelCatalogSync` rows.
 *
 * The weekly background catalog sync is removed by design: catalog refreshes
 * are explicit, user-triggered, per-connector actions whose outcome is
 * reported inline, so the "last synced" bookkeeping ledger this table held
 * has no reader.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired modelCatalogSync rows',
  description:
    'Deletes every modelCatalogSync bookkeeping row after snapshotting it: ' +
    'catalog refreshes are user-triggered per connector with no background ' +
    'sync, so the last-synced ledger has no reader. down restores the rows ' +
    'from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['modelCatalogSync'] },
  table: 'modelCatalogSync',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:modelCatalogSync', doc);
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

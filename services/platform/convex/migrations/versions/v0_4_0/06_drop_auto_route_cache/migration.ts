/**
 * 0.4.0 / 06 — drop the retired `autoRouteCache` rows.
 *
 * The "Auto" router is rebuilt without a database decision cache: routing is
 * decided per request from the live candidate roster, so the cached
 * (org, roster, message) → agent entries this table held have no reader.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired autoRouteCache rows',
  description:
    'Deletes every autoRouteCache row after snapshotting it: Auto routing is rebuilt without a DB decision cache, so the table has no reader. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['autoRouteCache'] },
  table: 'autoRouteCache',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:autoRouteCache', doc);
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

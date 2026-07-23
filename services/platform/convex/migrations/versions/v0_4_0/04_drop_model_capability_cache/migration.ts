/**
 * 0.4.0 / 04 — drop the retired `modelCapabilityCache` rows.
 *
 * Model capability facts now come from the provider-connector catalogs
 * (static `configs/platform/system/models/` files, or live listings fetched
 * per connector with an in-process daily cache) — never from a database
 * cache, and never merged back into org config. The table has no reader and
 * no writer; its rows are stale fetch output.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired modelCapabilityCache rows',
  description:
    'Deletes every modelCapabilityCache row after snapshotting it: the model ' +
    'catalog is now resolved per provider connector (static files or live ' +
    'listings) and never cached in a table. down restores the rows from the ' +
    'snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['modelCapabilityCache'] },
  table: 'modelCapabilityCache',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:modelCapabilityCache', doc);
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

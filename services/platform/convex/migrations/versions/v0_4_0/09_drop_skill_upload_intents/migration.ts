/**
 * 0.4.0 / 09 — drop the retired `skillUploadIntents` rows.
 *
 * Skill-bundle uploads bound an upload URL's blob to its org+user through this
 * table; the rebuilt upload path has no reader for those intent records.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired skillUploadIntents rows',
  description:
    'Deletes every skillUploadIntents row after snapshotting it: skill-bundle upload URL bindings are rebuilt and nothing reads this table. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['skillUploadIntents'] },
  table: 'skillUploadIntents',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:skillUploadIntents', doc);
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

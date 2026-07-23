/**
 * 0.4.0 / 08 — drop the retired `skillUploadClaims` rows.
 *
 * The skill-bundle upload swap used a per-(org, slug) exclusion lock recorded
 * here; the upload path is rebuilt and no code claims or reads this table.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired skillUploadClaims rows',
  description:
    'Deletes every skillUploadClaims row after snapshotting it: the skill-bundle upload swap lock is rebuilt and no code claims this table. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['skillUploadClaims'] },
  table: 'skillUploadClaims',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:skillUploadClaims', doc);
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

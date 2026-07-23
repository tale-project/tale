/**
 * 0.4.0 / 03 — drop the retired `reasoningProfiles` rows.
 *
 * The adaptive reasoning governor is removed from the platform: reasoning
 * depth is a per-request knob on the selected model, never a learned per-org
 * profile, so the governor's tuning state has nothing left to tune and no
 * reader anywhere.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired reasoningProfiles rows',
  description:
    'Deletes every reasoningProfiles row after snapshotting it: the adaptive ' +
    'reasoning governor is removed from the platform, so its per-org tuning ' +
    'state has nothing left to tune. down restores the rows from the ' +
    'snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['reasoningProfiles'] },
  table: 'reasoningProfiles',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:reasoningProfiles', doc);
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

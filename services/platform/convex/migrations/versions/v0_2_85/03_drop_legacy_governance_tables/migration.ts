/**
 * 0.2.85 / 03 — drop the legacy `governancePolicies` rows now that 01 exported
 * them to files and 02 moved the staged DSAR changes out.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` (so it can be rebuilt) and deletes it, so `down` (the
 * framework's generic snapshot-restore) rebuilds the table. Gated behind
 * explicit operator acceptance in the CLI. The runner dispatches
 * `restoreSnapshotBatch` for `table-rows` migrations and never calls the
 * `down` defined here, which is therefore a documented no-op.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the legacy governancePolicies rows (post-export cleanup)',
  description:
    'Deletes every legacy governancePolicies row after snapshotting it. The ' +
    'files written by 0.2.85/01 are the source of truth from here on. down ' +
    'restores the rows from the snapshot. Run only after verifying the ' +
    'exported governance files look correct.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['governancePolicies'] },
  table: 'governancePolicies',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:governancePolicies', doc);
    // Legacy table absent from the schema → delete untyped.
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
    await (ctx.db as any).delete(doc._id);
  },

  // Unused: `table-rows` rollback is the generic snapshot-restore in the runner.
  // Kept to satisfy the DbMigration contract.
  async down() {
    /* no-op — see restoreSnapshotBatch */
  },
});

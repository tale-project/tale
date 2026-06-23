/**
 * DB migration: snapshot-then-delete every legacy `modelSyncSettings` row.
 *
 * `up` snapshots each row into `migrationSnapshots` (so it can be rebuilt) and
 * deletes it. `down` is the framework's generic snapshot-restore — the runner
 * dispatches `restoreSnapshotBatch` for `table-rows` migrations and never calls
 * the `down` defined here, which is therefore a documented no-op.
 */

import type { MutationCtx } from '../../../../_generated/server';
import { snapshotRow } from '../../../framework/snapshot_helpers';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

export const migration: DbMigration = {
  meta,
  table: 'modelSyncSettings',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
    await snapshotRow(ctx, meta.id, 'table:modelSyncSettings', doc);
    // Legacy table absent from the schema → delete untyped.
    // oxlint-disable-next-line typescript/no-explicit-any -- legacy table absent from schema
    await (ctx.db as any).delete(doc._id);
  },

  // Unused: `table-rows` rollback is the generic snapshot-restore in the runner.
  // Kept to satisfy the DbMigration contract.
  async down() {
    /* no-op — see restoreSnapshotBatch */
  },
};

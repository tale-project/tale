/**
 * DB migration: snapshot-then-delete `userNotifications` rows of the retired
 * `workforce_digest` type. See {@link meta}.
 */

import type { Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import { snapshotRow } from '../../../framework/snapshot_helpers';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

export const migration: DbMigration = {
  meta,
  table: 'userNotifications',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
    if (doc.type !== 'workforce_digest') return;
    await snapshotRow(ctx, meta.id, 'table:userNotifications', doc);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- MigrationDoc ids are untyped by design
    await ctx.db.delete(doc._id as Id<'userNotifications'>);
  },

  // Unused: `table-rows` rollback is the generic snapshot-restore in the
  // runner. Kept to satisfy the DbMigration contract.
  async down() {
    /* no-op — see restoreSnapshotBatch */
  },
};

/**
 * 0.3.4 / 07 — drain the retired `workforce_digest` notification rows.
 *
 * The digest automation (and with it the only `workforce_digest` emitter) was
 * removed and the type's inbox i18n keys are gone, so surviving rows would
 * render raw keys in the bell. This migration deletes them. The
 * `v.literal('workforce_digest')` member stays in the `userNotifications`
 * type union ONE more release (the closed union validates existing rows at
 * schema push time — the same deploy-order constraint as adding a type, in
 * reverse); drop the literal once every deployment has run this. Contract
 * step (DESTRUCTIVE): each row is snapshotted into `migrationSnapshots`
 * before deletion, so `down` (the generic snapshot-restore) rebuilds it.
 */

import type { Id } from '../../../../_generated/dataModel';
import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Delete stored workforce_digest inbox notifications',
  description:
    'Deletes every userNotifications row with type workforce_digest (the ' +
    'digest automation and its i18n keys were removed; stale rows would ' +
    'render raw keys), after snapshotting each row. down restores the rows ' +
    'from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  formerIds: ['0.2.90/08_delete_workforce_digest_notifications'],
  subjects: { tables: ['userNotifications'] },
  table: 'userNotifications',

  async up(ctx, doc, run) {
    if (doc.type !== 'workforce_digest') return;
    await run.snapshotRow('table:userNotifications', doc);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- MigrationDoc ids are untyped by design
    await ctx.db.delete(doc._id as Id<'userNotifications'>);
  },

  // Unused: `table-rows` rollback is the generic snapshot-restore in the
  // runner. Kept to satisfy the DbMigration contract.
  async down() {
    /* no-op — see restoreSnapshotBatch */
  },
});

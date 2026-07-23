/**
 * 0.4.0 / 10 — drop the retired `slackEventDedup` rows.
 *
 * Inbound Slack event idempotency is rebuilt; the short-lived per-event dedupe
 * ledger this table held has no reader or writer.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired slackEventDedup rows',
  description:
    'Deletes every slackEventDedup row after snapshotting it: inbound Slack event idempotency is rebuilt and no reader remains. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['slackEventDedup'] },
  table: 'slackEventDedup',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:slackEventDedup', doc);
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

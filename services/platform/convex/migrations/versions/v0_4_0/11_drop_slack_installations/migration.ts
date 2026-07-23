/**
 * 0.4.0 / 11 — drop the retired `slackInstallations` rows.
 *
 * The shared Slack App routed inbound events back to the installing org
 * through this team-id table; Slack integration is rebuilt and nothing reads it.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired slackInstallations rows',
  description:
    'Deletes every slackInstallations row after snapshotting it: the shared Slack App routing table is rebuilt and nothing reads it. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['slackInstallations'] },
  table: 'slackInstallations',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:slackInstallations', doc);
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

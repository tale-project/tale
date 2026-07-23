/**
 * 0.4.0 / 07 — drop the retired `mcpServers` rows.
 *
 * Model Context Protocol server connections are rebuilt outside this table;
 * nothing in the live tree reads or writes these per-org server records.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte. The table leaves the
 * schema in the same change once this drain lands.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired mcpServers rows',
  description:
    'Deletes every mcpServers row after snapshotting it: MCP server connections are rebuilt outside this table and nothing reads it. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['mcpServers'] },
  table: 'mcpServers',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:mcpServers', doc);
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

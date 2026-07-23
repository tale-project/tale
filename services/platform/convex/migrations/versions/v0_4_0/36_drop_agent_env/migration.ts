/**
 * 0.4.0 / 36 — drop the retired `agentEnv` rows.
 *
 * An agent held its own environment variables and secrets, one row per
 * (organization, agent, key). An agent is now a persona and holds no
 * credentials at all: they belong to the organization's provider and
 * integration records, where they are rotated and audited in one place. The
 * table has no reader and no writer left.
 *
 * Contract step (DESTRUCTIVE): `up` snapshots each row into
 * `migrationSnapshots` and deletes it; `down` (the framework's generic
 * snapshot-restore) rebuilds the table byte-for-byte, secrets included — the
 * ciphertext is snapshotted exactly as it was stored and never decrypted. The
 * table leaves the schema in the same change as this drain.
 */

import { defineDbMigration } from '../../../framework/define';

export const migration = defineDbMigration({
  title: 'Drop the retired agentEnv rows',
  description:
    'Deletes every agentEnv row after snapshotting it: an agent is a persona and holds no credentials, so the per-agent env and secret store has no reader or writer left. down restores the rows — ciphertext untouched — from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['agentEnv'] },
  table: 'agentEnv',

  async up(ctx, doc, run) {
    await run.snapshotRow('table:agentEnv', doc);
    // Retired table absent from the schema → delete untyped.
    // oxlint-disable-next-line typescript/no-explicit-any -- retired table absent from schema
    await (ctx.db as any).delete(doc._id);
  },

  // Unused: `table-rows` rollback is the generic snapshot-restore in the
  // runner. Kept to satisfy the DbMigration contract.
  async down() {
    /* no-op — see restoreSnapshotBatch */
  },
});

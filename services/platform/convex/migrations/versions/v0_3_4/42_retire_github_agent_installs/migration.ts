/**
 * 0.3.4 / 42 — drop install rows of the retired github agents.
 *
 * The sibling node migration (0.3.4/34) deletes the free-floating agent
 * FILES; this db migration removes their `agentInstallations` rows so the
 * roster gate stops treating them as installed. Contract step (DESTRUCTIVE):
 * each row is snapshotted into `migrationSnapshots` before deletion, so
 * `down` (the generic snapshot-restore) rebuilds the rows.
 */

import type { Id } from '../../../../_generated/dataModel';
import { defineDbMigration } from '../../../framework/define';
import { RETIRED_AGENT_SLUGS } from '../33_workflows_become_automations/mapping';

const RETIRED: ReadonlySet<string> = new Set(RETIRED_AGENT_SLUGS);

export const migration = defineDbMigration({
  title: 'Drop install rows of the retired github agents',
  description:
    'Deletes every agentInstallations row for the retired issue-triager and ' +
    'pull-request-reviewer bundle agents after snapshotting each row; down ' +
    'restores the rows from the snapshot byte-for-byte.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['agentInstallations'] },
  table: 'agentInstallations',

  async up(ctx, doc, run) {
    if (typeof doc.agentSlug !== 'string' || !RETIRED.has(doc.agentSlug)) {
      return;
    }
    await run.snapshotRow('table:agentInstallations', doc);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- MigrationDoc ids are untyped by design
    await ctx.db.delete(doc._id as Id<'agentInstallations'>);
  },

  // Unused: `table-rows` rollback is the generic snapshot-restore in the
  // runner. Kept to satisfy the DbMigration contract.
  async down() {
    /* no-op — see restoreSnapshotBatch */
  },
});

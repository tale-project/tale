/**
 * 0.3.4 / 43 — drop install rows of the retired standalone workflows.
 *
 * The three slugs in `RETIRED_STANDALONE_WORKFLOW_SLUGS` were superseded (the
 * GitHub pair by the sync-github-issues / review-github-pr automations, the
 * generic mail sync by the folded per-provider ones) — no remap target
 * exists, so their `wfInstallations` rows are deleted after snapshotting.
 * Leftover schedule/subscription/provision rows for these slugs stay as
 * inert history: without an installation row, `processEvent` and the
 * scheduler both refuse to fire them. `down` is the generic
 * snapshot-restore.
 */

import type { Id } from '../../../../_generated/dataModel';
import { defineDbMigration } from '../../../framework/define';
import { RETIRED_STANDALONE_WORKFLOW_SLUGS } from '../33_workflows_become_automations/mapping';

const RETIRED: ReadonlySet<string> = new Set(RETIRED_STANDALONE_WORKFLOW_SLUGS);

export const migration = defineDbMigration({
  title: 'Drop install rows of the retired standalone workflows',
  description:
    'Deletes every wfInstallations row for the three retired standalone ' +
    'workflow slugs superseded by automations after snapshotting each row; ' +
    'leftover trigger rows are inert without an installation; down restores ' +
    'the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  subjects: { tables: ['wfInstallations'] },
  table: 'wfInstallations',

  async up(ctx, doc, run) {
    if (
      typeof doc.workflowSlug !== 'string' ||
      !RETIRED.has(doc.workflowSlug)
    ) {
      return;
    }
    await run.snapshotRow('table:wfInstallations', doc);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- MigrationDoc ids are untyped by design
    await ctx.db.delete(doc._id as Id<'wfInstallations'>);
  },

  // Unused: `table-rows` rollback is the generic snapshot-restore in the
  // runner. Kept to satisfy the DbMigration contract.
  async down() {
    /* no-op — see restoreSnapshotBatch */
  },
});

/**
 * 0.3.4 / 05 — drop installation rows of the retired workforce personas.
 *
 * The sibling node migration (0.3.4/04) deletes the persona agent FILES;
 * this db migration removes their `agentInstallations` rows so the roster
 * gate stops treating retired personas as installed. Rows are matched by the
 * 16 retired catalog slugs. Contract step (DESTRUCTIVE): each row is
 * snapshotted into `migrationSnapshots` before deletion, so `down` (the
 * generic snapshot-restore) rebuilds the rows.
 */

import type { Id } from '../../../../_generated/dataModel';
import { defineDbMigration } from '../../../framework/define';

/** The 16 persona slugs the retired `agents/workforce/` catalog shipped. */
export const WORKFORCE_AGENT_SLUGS: ReadonlySet<string> = new Set([
  'account-executive',
  'analyst',
  'chief-executive-officer',
  'chief-marketing-officer',
  'chief-operating-officer',
  'chief-technology-officer',
  'content-writer',
  'customer-support-agent',
  'designer',
  'legal-counsel',
  'product-manager',
  'project-manager',
  'qa-engineer',
  'security-engineer',
  'software-architect',
  'software-developer',
]);

export const migration = defineDbMigration({
  title: 'Delete agentInstallations rows of the retired workforce personas',
  description:
    'Deletes every agentInstallations row whose agentSlug is one of the 16 ' +
    'retired workforce persona slugs (chief-executive-officer, analyst, …), ' +
    'after snapshotting it. Note: an org-authored custom agent that reused ' +
    'one of these exact slugs would lose its installation row too — restore ' +
    'via down if that ever bites. down restores the rows from the snapshot.',
  destructive: true,
  snapshot: 'table-rows',
  formerIds: ['0.2.90/06_drop_workforce_agent_installations'],
  subjects: { tables: ['agentInstallations'] },
  table: 'agentInstallations',

  async up(ctx, doc, run) {
    if (
      typeof doc.agentSlug !== 'string' ||
      !WORKFORCE_AGENT_SLUGS.has(doc.agentSlug)
    ) {
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

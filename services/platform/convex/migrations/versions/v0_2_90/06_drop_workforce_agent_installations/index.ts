/**
 * DB migration: snapshot-then-delete `agentInstallations` rows of the retired
 * workforce persona agents. See {@link meta}.
 */

import type { Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import { snapshotRow } from '../../../framework/snapshot_helpers';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

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

export const migration: DbMigration = {
  meta,
  table: 'agentInstallations',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
    if (
      typeof doc.agentSlug !== 'string' ||
      !WORKFORCE_AGENT_SLUGS.has(doc.agentSlug)
    ) {
      return;
    }
    await snapshotRow(ctx, meta.id, 'table:agentInstallations', doc);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- MigrationDoc ids are untyped by design
    await ctx.db.delete(doc._id as Id<'agentInstallations'>);
  },

  // Unused: `table-rows` rollback is the generic snapshot-restore in the
  // runner. Kept to satisfy the DbMigration contract.
  async down() {
    /* no-op — see restoreSnapshotBatch */
  },
};

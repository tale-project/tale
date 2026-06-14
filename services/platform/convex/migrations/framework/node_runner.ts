'use node';

/**
 * Runs a single `node` migration against a single organization. The
 * orchestrating action (`entrypoints.applyUp/applyDown`) enumerates orgs and
 * calls this once per org so progress is resumable at org granularity.
 *
 * This is the only place that assembles the `NodeMigrationHelpers` (the
 * filesystem surface), keeping `node:*` access out of the handler modules.
 */

import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import { atomicWrite, readFileSafe } from '../../lib/file_io';
import { NODE_MIGRATIONS } from './registry.node';
import { restoreFsTree, snapshotFsTree } from './snapshot_store';
import type { NodeMigrationHelpers } from './types';

const helpers: NodeMigrationHelpers = {
  atomicWrite,
  readFileSafe,
  snapshotFsTree,
  restoreFsTree,
};

/** Apply one `node` migration to one org, forward or inverse. */
export const applyNodeForOrg = internalAction({
  args: {
    migrationId: v.string(),
    orgId: v.string(),
    orgSlug: v.string(),
    direction: v.union(v.literal('up'), v.literal('down')),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const migration = NODE_MIGRATIONS[args.migrationId];
    if (!migration) {
      throw new Error(`Unknown node migration: ${args.migrationId}`);
    }
    const org = { id: args.orgId, slug: args.orgSlug };
    if (args.direction === 'up') {
      await migration.up(ctx, org, helpers);
    } else {
      await migration.down(ctx, org, helpers);
    }
    return null;
  },
});

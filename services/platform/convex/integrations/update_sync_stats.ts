/**
 * Update sync statistics for an integration
 */

import { Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';

export interface UpdateSyncStatsArgs {
  integrationId: Id<'integrations'>;
  totalRecords?: number;
  lastSyncCount?: number;
  failedSyncCount?: number;
}

export async function updateSyncStats(
  ctx: MutationCtx,
  args: UpdateSyncStatsArgs,
): Promise<void> {
  const integration = await ctx.db.get(args.integrationId);
  if (!integration) {
    throw new Error('Integration not found');
  }

  await ctx.db.patch(args.integrationId, {
    lastSyncedAt: Date.now(),
    lastSuccessAt: Date.now(),
    syncStats: {
      totalRecords: args.totalRecords ?? integration.syncStats?.totalRecords,
      lastSyncCount: args.lastSyncCount,
      failedSyncCount: args.failedSyncCount,
    },
  });
}

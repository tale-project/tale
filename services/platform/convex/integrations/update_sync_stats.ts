/**
 * Update sync statistics for an integration
 */

import { Id } from '../_generated/dataModel';
import { MutationCtx } from '../_generated/server';

export interface UpdateSyncStatsArgs {
  credentialId: Id<'integrationCredentials'>;
  totalRecords?: number;
  lastSyncCount?: number;
  failedSyncCount?: number;
}

export async function updateSyncStats(
  ctx: MutationCtx,
  args: UpdateSyncStatsArgs,
): Promise<void> {
  const credential = await ctx.db.get(args.credentialId);
  if (!credential) {
    throw new Error('Integration credentials not found');
  }

  await ctx.db.patch(args.credentialId, {
    lastSyncedAt: Date.now(),
    lastSuccessAt: Date.now(),
    syncStats: {
      totalRecords: args.totalRecords ?? credential.syncStats?.totalRecords,
      lastSyncCount: args.lastSyncCount,
      failedSyncCount: args.failedSyncCount,
    },
  });
}

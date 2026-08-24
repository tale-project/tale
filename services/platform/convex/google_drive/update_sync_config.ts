/**
 * Update Google Drive sync config status and metadata.
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export interface UpdateSyncConfigResult {
  success: boolean;
}

export async function updateSyncConfig(
  ctx: MutationCtx,
  args: {
    configId: Id<'googleDriveSyncConfigs'>;
    status?: 'active' | 'inactive' | 'error';
    lastSyncAt?: number;
    lastSyncStatus?: string;
    errorMessage?: string;
    organizationId?: string;
  },
): Promise<UpdateSyncConfigResult> {
  if (args.organizationId !== undefined) {
    const cfg = await ctx.db.get(args.configId);
    if (!cfg || cfg.organizationId !== args.organizationId) {
      throw new Error('Sync config not found');
    }
  }
  const updates: {
    status?: 'active' | 'inactive' | 'error';
    lastSyncAt?: number;
    lastSyncStatus?: string;
    errorMessage?: string;
  } = {};

  if (args.status !== undefined) {
    updates.status = args.status;
  }
  if (args.lastSyncAt !== undefined) {
    updates.lastSyncAt = args.lastSyncAt;
  }
  if (args.lastSyncStatus !== undefined) {
    updates.lastSyncStatus = args.lastSyncStatus;
  }
  if (args.errorMessage !== undefined) {
    updates.errorMessage = args.errorMessage;
  }

  await ctx.db.patch(args.configId, updates);

  return { success: true };
}

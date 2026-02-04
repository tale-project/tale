/**
 * Update Sync Config - Business logic for updating OneDrive sync config status
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export interface UpdateSyncConfigResult {
  success: boolean;
}

/**
 * Update sync config status and metadata
 */
export async function updateSyncConfig(
  ctx: MutationCtx,
  args: {
    configId: Id<'onedriveSyncConfigs'>;
    status?: 'active' | 'inactive' | 'error';
    lastSyncAt?: number;
    lastSyncStatus?: string;
    errorMessage?: string;
  },
): Promise<UpdateSyncConfigResult> {
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

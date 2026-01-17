/**
 * Get OneDrive sync configurations
 */

import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';

export async function getOneDriveSyncConfigs(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    status?: 'active' | 'inactive' | 'error';
  },
): Promise<{
  success: boolean;
  configs?: Array<{
    id: string;
    userId: string;
    itemType: 'file' | 'folder';
    itemId: string;
    itemName: string;
    itemPath?: string;
    targetBucket: string;
    storagePrefix?: string;
    status: 'active' | 'inactive' | 'error';
    lastSyncAt?: number;
    lastSyncStatus?: string;
    errorMessage?: string;
    createdAt: number;
  }>;
  error?: string;
}> {
  try {
    // Query sync configs with optional status filter
    const configs: Array<Doc<'onedriveSyncConfigs'>> = [];
    if (args.status !== undefined) {
      const statusValue: 'active' | 'inactive' | 'error' = args.status;
      for await (const config of ctx.db
        .query('onedriveSyncConfigs')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', statusValue),
        )) {
        configs.push(config);
      }
    } else {
      for await (const config of ctx.db
        .query('onedriveSyncConfigs')
        .withIndex('by_organizationId', (q) =>
          q.eq('organizationId', args.organizationId),
        )) {
        configs.push(config);
      }
    }

    return {
      success: true,
      configs: configs.map((config) => ({
        id: config._id,
        userId: config.userId,
        itemType: config.itemType,
        itemId: config.itemId,
        itemName: config.itemName,
        itemPath: config.itemPath,
        targetBucket: config.targetBucket,
        storagePrefix: config.storagePrefix,
        status: config.status,
        lastSyncAt: config.lastSyncAt,
        lastSyncStatus: config.lastSyncStatus,
        errorMessage: config.errorMessage,
        createdAt: config._creationTime,
      })),
    };
  } catch (error) {
    console.error('Error getting sync configs:', error);
    return {
      success: false,
      error: 'Failed to retrieve sync configurations',
    };
  }
}

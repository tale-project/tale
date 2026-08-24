/**
 * Create or reactivate a Google Drive sync configuration.
 */

import type { MutationCtx } from '../_generated/server';

export async function createGoogleDriveSyncConfig(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    userId: string;
    itemType: 'file' | 'folder';
    itemId: string;
    itemName: string;
    itemPath?: string;
    targetBucket: string;
    storagePrefix?: string;
    teamId?: string;
  },
): Promise<{ success: boolean; configId?: string; error?: string }> {
  try {
    const existingConfig = await ctx.db
      .query('googleDriveSyncConfigs')
      .withIndex('by_organizationId_and_itemId', (q) =>
        q.eq('organizationId', args.organizationId).eq('itemId', args.itemId),
      )
      .first();

    if (existingConfig) {
      if (existingConfig.status === 'active') {
        return {
          success: true,
          configId: existingConfig._id,
        };
      }

      await ctx.db.patch(existingConfig._id, {
        status: 'active',
        userId: args.userId,
        itemName: args.itemName,
        itemPath: args.itemPath,
        targetBucket: args.targetBucket,
        storagePrefix: args.storagePrefix,
        teamId: args.teamId,
      });

      return {
        success: true,
        configId: existingConfig._id,
      };
    }

    const configId = await ctx.db.insert('googleDriveSyncConfigs', {
      organizationId: args.organizationId,
      userId: args.userId,
      itemType: args.itemType,
      itemId: args.itemId,
      itemName: args.itemName,
      itemPath: args.itemPath,
      targetBucket: args.targetBucket,
      storagePrefix: args.storagePrefix,
      teamId: args.teamId,
      status: 'active',
    });

    return {
      success: true,
      configId,
    };
  } catch (error) {
    console.error('Error creating Google Drive sync config:', error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to create sync config',
    };
  }
}

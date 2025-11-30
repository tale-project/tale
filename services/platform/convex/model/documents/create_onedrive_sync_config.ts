/**
 * Create OneDrive sync configuration
 */

import type { MutationCtx } from '../../_generated/server';

export async function createOneDriveSyncConfig(
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
  },
): Promise<{ success: boolean; configId?: string; error?: string }> {
  try {
    // Check if sync config already exists for this item
    const existingConfig = await ctx.db
      .query('onedriveSyncConfigs')
      .withIndex('by_organizationId_and_itemId', (q) =>
        q.eq('organizationId', args.organizationId).eq('itemId', args.itemId),
      )
      .first();

    if (existingConfig) {
      // Return existing config if active
      if (existingConfig.status === 'active') {
        return {
          success: true,
          configId: existingConfig._id,
        };
      }

      // Reactivate if inactive
      await ctx.db.patch(existingConfig._id, {
        status: 'active',
        userId: args.userId,
        itemName: args.itemName,
        itemPath: args.itemPath,
        targetBucket: args.targetBucket,
        storagePrefix: args.storagePrefix,
      });

      return {
        success: true,
        configId: existingConfig._id,
      };
    }

    // Create new sync configuration
    const configId = await ctx.db.insert('onedriveSyncConfigs', {
      organizationId: args.organizationId,
      userId: args.userId,
      itemType: args.itemType,
      itemId: args.itemId,
      itemName: args.itemName,
      itemPath: args.itemPath,
      targetBucket: args.targetBucket,
      storagePrefix: args.storagePrefix,
      status: 'active',
    });

    return {
      success: true,
      configId,
    };
  } catch (error) {
    console.error('Error creating sync config:', error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Failed to create sync config',
    };
  }
}

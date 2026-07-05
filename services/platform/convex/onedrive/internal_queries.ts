import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getUserToken as getUserTokenImpl } from './get_user_token';

export const getSyncConfig = internalQuery({
  args: {
    configId: v.id('onedriveSyncConfigs'),
  },
  returns: v.union(
    v.object({
      organizationId: v.string(),
      userId: v.string(),
      itemType: v.union(v.literal('file'), v.literal('folder')),
      itemId: v.string(),
      itemName: v.string(),
      itemPath: v.optional(v.string()),
      teamId: v.optional(v.string()),
      status: v.union(
        v.literal('active'),
        v.literal('inactive'),
        v.literal('error'),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const config = await ctx.db.get(args.configId);
    if (!config) return null;
    return {
      organizationId: config.organizationId,
      userId: config.userId,
      itemType: config.itemType,
      itemId: config.itemId,
      itemName: config.itemName,
      itemPath: config.itemPath,
      teamId: config.teamId,
      status: config.status,
    };
  },
});

export const listActiveSyncConfigs = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(
    v.object({
      configId: v.id('onedriveSyncConfigs'),
      userId: v.string(),
      itemType: v.union(v.literal('file'), v.literal('folder')),
      itemId: v.string(),
      itemName: v.string(),
      itemPath: v.optional(v.string()),
      storagePrefix: v.optional(v.string()),
      teamId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('onedriveSyncConfigs')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'active'),
      )
      .collect();
    return rows.map((config) => ({
      configId: config._id,
      userId: config.userId,
      itemType: config.itemType,
      itemId: config.itemId,
      itemName: config.itemName,
      itemPath: config.itemPath,
      storagePrefix: config.storagePrefix,
      teamId: config.teamId,
    }));
  },
});

export const getUserToken = internalQuery({
  args: {
    userId: v.string(),
  },
  returns: v.object({
    token: v.union(v.string(), v.null()),
    needsRefresh: v.boolean(),
    accountId: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    return await getUserTokenImpl(ctx, args);
  },
});

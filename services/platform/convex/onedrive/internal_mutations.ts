/**
 * OneDrive Internal Mutations
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { updateSyncConfigLogic } from './update_sync_config_logic';
import * as MicrosoftAccountsModel from '../accounts/helpers';

export const updateSyncConfig = internalMutation({
  args: {
    configId: v.id('onedriveSyncConfigs'),
    status: v.optional(v.union(v.literal('active'), v.literal('inactive'), v.literal('error'))),
    lastSyncAt: v.optional(v.number()),
    lastSyncStatus: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await updateSyncConfigLogic(ctx, args);
  },
});

export const updateTokens = internalMutation({
  args: {
    accountId: v.string(),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
    refreshToken: v.optional(v.string()),
    refreshTokenExpiresAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await MicrosoftAccountsModel.updateMicrosoftTokens(ctx, {
      accountId: args.accountId,
      accessToken: args.accessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      refreshToken: args.refreshToken,
      refreshTokenExpiresAt: args.refreshTokenExpiresAt ?? null,
    });
    return null;
  },
});

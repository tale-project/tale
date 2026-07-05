/**
 * OneDrive Internal Mutations
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import * as MicrosoftAccountsModel from '../accounts/helpers';
import { createOneDriveSyncConfig } from '../documents/create_onedrive_sync_config';
import { updateSyncConfig as updateSyncConfigImpl } from './update_sync_config';

export const upsertSyncConfig = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    itemType: v.union(v.literal('file'), v.literal('folder')),
    itemId: v.string(),
    itemName: v.string(),
    itemPath: v.optional(v.string()),
    targetBucket: v.string(),
    storagePrefix: v.optional(v.string()),
    teamId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    configId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const result = await createOneDriveSyncConfig(ctx, args);
    if (result.success) {
      // Idempotent compensation: every sync config upsert re-checks workflow
      // install + schedule triggers (safe to run repeatedly).
      await ctx.scheduler.runAfter(
        0,
        internal.onedrive.ensure_sync_workflow.ensureSyncWorkflowEngine,
        { organizationId: args.organizationId },
      );
    }
    return result;
  },
});

export const updateSyncConfig = internalMutation({
  args: {
    configId: v.id('onedriveSyncConfigs'),
    status: v.optional(
      v.union(v.literal('active'), v.literal('inactive'), v.literal('error')),
    ),
    lastSyncAt: v.optional(v.number()),
    lastSyncStatus: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    // Caller's org — when set, updateSyncConfig rejects a config in another
    // tenant. The workflow onedrive action passes it.
    organizationId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await updateSyncConfigImpl(ctx, args);
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

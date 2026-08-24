/**
 * Google Drive Internal Mutations
 */

import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { createGoogleDriveSyncConfig } from '../documents/create_google_drive_sync_config';
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
    return await createGoogleDriveSyncConfig(ctx, args);
  },
});

export const updateSyncConfig = internalMutation({
  args: {
    configId: v.id('googleDriveSyncConfigs'),
    status: v.optional(
      v.union(v.literal('active'), v.literal('inactive'), v.literal('error')),
    ),
    lastSyncAt: v.optional(v.number()),
    lastSyncStatus: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    organizationId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await updateSyncConfigImpl(ctx, args);
  },
});

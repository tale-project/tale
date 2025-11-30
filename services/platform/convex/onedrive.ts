/**
 * OneDrive Internal Functions
 *
 * Thin wrappers around business logic in the model layer.
 * These functions are called by the onedrive workflow action.
 */

import {
  internalQuery,
  internalMutation,
  internalAction,
} from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import * as OnedriveModel from './model/onedrive';

/**
 * Get Microsoft Graph token for a specific user
 * Thin wrapper around getUserTokenLogic
 */
export const getUserMicrosoftGraphToken = internalQuery({
  args: { userId: v.string() },
  returns: v.object({
    token: v.union(v.string(), v.null()),
    needsRefresh: v.boolean(),
    accountId: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    return await OnedriveModel.getUserTokenLogic(ctx, args);
  },
});

/**
 * Refresh Microsoft Graph token using refresh token
 * Thin wrapper around refreshTokenLogic
 */
export const refreshMicrosoftGraphToken = internalAction({
  args: {
    accountId: v.string(),
    refreshToken: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    accessToken: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    return await OnedriveModel.refreshTokenLogic(args, {
      runMutation: ctx.runMutation,
      updateTokens: async (_mutationCtx, tokenArgs) => {
        const _result: null = await ctx.runMutation(
          internal.onedrive.updateMicrosoftTokens,
          tokenArgs,
        );
      },
    });
  },
});

/**
 * Update Microsoft account tokens
 * Thin wrapper around model logic.
 */
export const updateMicrosoftTokens = internalMutation({
  args: {
    accountId: v.string(),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
    refreshToken: v.optional(v.string()),
    refreshTokenExpiresAt: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await OnedriveModel.updateMicrosoftTokensLogic(ctx, args);
    return null;
  },
});

/**
 * Read file from OneDrive using Microsoft Graph API
 * This is an action because it makes external API calls
 */
export const readFileFromOneDrive = internalAction({
  args: {
    itemId: v.string(),
    token: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    content: v.optional(v.any()),
    mimeType: v.optional(v.string()),
    size: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => {
    return await OnedriveModel.readFileLogic(args);
  },
});

/**
 * List files in a OneDrive folder using Microsoft Graph API
 * This is an action because it makes external API calls
 */
export const listFolderContents = internalAction({
  args: {
    itemId: v.string(),
    token: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    files: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          size: v.number(),
          mimeType: v.optional(v.string()),
          lastModified: v.optional(v.number()),
        }),
      ),
    ),
    error: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => {
    return await OnedriveModel.listFolderContentsLogic(args);
  },
});

/**
 * Create sync config records for files in a folder
 * This allows each file to be processed individually in subsequent workflow runs
 */
export const createSyncConfigsForFiles = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    targetBucket: v.string(),
    folderStoragePrefix: v.string(),
    folderItemPath: v.string(),
    files: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        size: v.number(),
        mimeType: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await OnedriveModel.createSyncConfigsLogic(ctx, args);
  },
});

/**
 * Update OneDrive sync configuration status
 */
export const updateSyncConfig = internalMutation({
  args: {
    configId: v.id('onedriveSyncConfigs'),
    status: v.optional(
      v.union(v.literal('active'), v.literal('inactive'), v.literal('error')),
    ),
    lastSyncAt: v.optional(v.number()),
    lastSyncStatus: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await OnedriveModel.updateSyncConfigLogic(ctx, args as any);
    return null;
  },
});

/**
 * Upload file to Convex storage and create or update a document.
 * Thin wrapper around model uploadAndCreateDocumentLogic.
 */
export const uploadToStorage = internalAction({
  args: {
    organizationId: v.string(),
    fileName: v.string(),
    fileData: v.any(), // ArrayBuffer or string
    contentType: v.string(),
    metadata: v.any(),
    documentIdToUpdate: v.optional(v.id('documents')),
  },
  returns: v.object({
    success: v.boolean(),
    fileId: v.optional(v.id('_storage')),
    documentId: v.optional(v.id('documents')),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const result = await OnedriveModel.uploadAndCreateDocumentLogic(
      {
        organizationId: args.organizationId,
        fileName: args.fileName,
        fileContent: args.fileData as ArrayBuffer | string,
        contentType: args.contentType,
        metadata: (args.metadata ?? {}) as Record<string, unknown>,
        documentIdToUpdate: args.documentIdToUpdate,
      },
      {
        storageStore: ctx.storage.store,
        createDocument: async (createArgs) => {
          const res = await ctx.runMutation(internal.documents.createDocument, {
            organizationId: createArgs.organizationId,
            title: createArgs.title,
            fileId: createArgs.fileId,
            metadata: createArgs.metadata,
            sourceProvider: createArgs.sourceProvider,
            externalItemId: createArgs.externalItemId,
          });
          return { documentId: res.documentId };
        },
        updateDocument: async (updateArgs) => {
          await ctx.runMutation(internal.documents.updateDocumentInternal, {
            documentId: updateArgs.documentId,
            title: updateArgs.title,
            fileId: updateArgs.fileId,
            metadata: updateArgs.metadata,
            sourceProvider: updateArgs.sourceProvider,
            externalItemId: updateArgs.externalItemId,
          });
        },
      },
    );

    return result;
  },
});

'use node';

/**
 * OneDrive Internal Actions
 * Thin wrappers that delegate to implementation files
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { downloadAndStoreFile as downloadAndStoreFileImpl } from './download_and_store_file';
import { listFolderContents as listFolderContentsImpl } from './list_folder_contents';
import { readFile as readFileImpl } from './read_file';
import { refreshToken as refreshTokenImpl } from './refresh_token';
import { uploadAndCreateDocument as uploadAndCreateDocumentImpl } from './upload_and_create_document';
import { createUploadAndCreateDocDeps } from './upload_and_create_document_deps';

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
    return await listFolderContentsImpl(args);
  },
});

export const readFileFromOneDrive = internalAction({
  args: {
    itemId: v.string(),
    token: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    content: v.optional(v.bytes()),
    mimeType: v.optional(v.string()),
    size: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => {
    const result = await readFileImpl(args);
    return {
      success: result.success,
      content: result.content,
      mimeType: result.mimeType,
      size: result.size,
      error: result.error,
    };
  },
});

export const refreshToken = internalAction({
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
    const result = await refreshTokenImpl({ refreshToken: args.refreshToken });

    if (!result.success || !result.accessToken || !result.expiresAt) {
      return { success: false, error: result.error };
    }

    await ctx.runMutation(internal.onedrive.internal_mutations.updateTokens, {
      accountId: args.accountId,
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.expiresAt,
      refreshToken: result.newRefreshToken || args.refreshToken,
      refreshTokenExpiresAt: result.refreshTokenExpiresAt,
    });

    return { success: true, accessToken: result.accessToken };
  },
});

export const downloadAndStoreFile = internalAction({
  args: {
    itemId: v.string(),
    token: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    storageId: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    return await downloadAndStoreFileImpl(args, {
      storeFile: async (blob) => ctx.storage.store(blob),
    });
  },
});

export const uploadToStorage = internalAction({
  args: {
    organizationId: v.string(),
    fileName: v.string(),
    fileData: v.bytes(),
    contentType: v.string(),
    metadata: v.optional(jsonRecordValidator),
    documentIdToUpdate: v.optional(v.id('documents')),
    createdBy: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    fileId: v.optional(v.id('_storage')),
    documentId: v.optional(v.id('documents')),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    return await uploadAndCreateDocumentImpl(
      {
        organizationId: args.organizationId,
        fileName: args.fileName,
        fileContent: args.fileData,
        contentType: args.contentType,
        metadata: args.metadata ?? {},
        documentIdToUpdate: args.documentIdToUpdate,
        createdBy: args.createdBy,
      },
      createUploadAndCreateDocDeps(ctx),
    );
  },
});

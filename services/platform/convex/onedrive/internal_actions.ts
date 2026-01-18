'use node';

/**
 * OneDrive Internal Actions
 */

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { listFolderContentsLogic } from './list_folder_contents_logic';
import { readFileLogic } from './read_file_logic';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import type { Id } from '../_generated/dataModel';

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
    return await listFolderContentsLogic(args);
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
    const result = await readFileLogic(args);
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
    try {
      const tenantId = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
      const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
      const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;

      if (!tenantId || !clientId || !clientSecret) {
        console.error('refreshToken: Missing OAuth credentials');
        return { success: false, error: 'Missing OAuth credentials' };
      }

      const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: args.refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('refreshToken: Token refresh failed:', errorText);
        return { success: false, error: `Token refresh failed: ${response.status}` };
      }

      const data = await response.json() as {
        access_token: string;
        expires_in: number;
        refresh_token?: string;
        refresh_token_expires_in?: number;
      };

      const expiresAt = Date.now() + data.expires_in * 1000;

      // Update tokens in database
      await ctx.runMutation(internal.onedrive.internal_mutations.updateTokens, {
        accountId: args.accountId,
        accessToken: data.access_token,
        accessTokenExpiresAt: expiresAt,
        refreshToken: data.refresh_token || args.refreshToken,
        refreshTokenExpiresAt: data.refresh_token_expires_in
          ? Date.now() + data.refresh_token_expires_in * 1000
          : undefined,
      });

      return { success: true, accessToken: data.access_token };
    } catch (error) {
      console.error('refreshToken: Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

type UploadResult = {
  success: boolean;
  fileId?: Id<'_storage'>;
  documentId?: Id<'documents'>;
  error?: string;
};

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
  handler: async (ctx, args): Promise<UploadResult> => {
    try {
      const blob = new Blob([args.fileData], { type: args.contentType });
      const storageId = await ctx.storage.store(blob);

      if (args.documentIdToUpdate) {
        await ctx.runMutation(internal.documents.mutations.updateDocumentInternal, {
          documentId: args.documentIdToUpdate,
          fileId: storageId,
          title: args.fileName,
          metadata: args.metadata,
        });

        return {
          success: true,
          fileId: storageId,
          documentId: args.documentIdToUpdate,
        };
      } else {
        const documentId: Id<'documents'> = await ctx.runMutation(internal.documents.mutations.createDocumentInternal, {
          organizationId: args.organizationId,
          title: args.fileName,
          fileId: storageId,
          sourceProvider: 'onedrive',
          metadata: args.metadata,
          createdBy: args.createdBy,
        });

        return {
          success: true,
          fileId: storageId,
          documentId,
        };
      }
    } catch (error) {
      console.error('uploadToStorage error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

/**
 * OneDrive API - Convex Actions
 *
 * This module provides Convex actions for interacting with Microsoft OneDrive
 * via the Microsoft Graph API. All authentication and token management is
 * handled within Convex.
 */

import { v } from 'convex/values';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server';
import { internal } from './_generated/api';
import { components } from './_generated/api';
import type { ActionCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { checkUserRateLimit } from './lib/rate_limiter/helpers';

// Import validators from model
import {
  driveItemsResponseValidator,
  syncConfigStatusValidator,
  fileItemValidator,
  listFilesResponseValidator,
  readFileResponseValidator,
  readFileFromOnedriveResponseValidator,
  listFolderContentsResponseValidator,
  uploadToStorageResponseValidator,
  refreshTokenResponseValidator,
  getUserTokenResponseValidator,
} from './model/onedrive/validators';

// =============================================================================
// TYPES
// =============================================================================

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  webUrl: string;
  downloadUrl?: string;
  file?: {
    mimeType: string;
    hashes?: {
      sha1Hash?: string;
      sha256Hash?: string;
    };
  };
  folder?: {
    childCount: number;
  };
  parentReference?: {
    driveId: string;
    driveType: string;
    id: string;
    path: string;
  };
}

interface DriveItemsResponse {
  '@odata.context'?: string;
  '@odata.nextLink'?: string;
  value: DriveItem[];
}

interface MicrosoftAccount {
  accountId: string;
  userId: string;
  providerId: string;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: number | null;
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Get Microsoft account for the current user
 */
async function getMicrosoftAccountInternal(
  ctx: ActionCtx,
): Promise<MicrosoftAccount | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  // Get Better Auth user
  const authUsers = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'user',
      where: [{ field: '_id', value: identity.subject, operator: 'eq' }],
      paginationOpts: { cursor: null, numItems: 1 },
    },
  );

  if (!authUsers?.page?.length) {
    return null;
  }

  const authUser = authUsers.page[0];

  // Get Microsoft account
  const microsoftResult = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'account',
      where: [
        { field: 'userId', value: String(authUser._id), operator: 'eq' },
        { field: 'providerId', value: 'microsoft', operator: 'eq' },
      ],
      paginationOpts: { cursor: null, numItems: 1 },
    },
  );

  const microsoftAccounts = microsoftResult?.page || [];
  if (microsoftAccounts.length === 0) {
    return null;
  }

  const account = microsoftAccounts[0];
  return {
    accountId: account.accountId,
    userId: account.userId,
    providerId: account.providerId,
    accessToken: account.accessToken ?? null,
    accessTokenExpiresAt: account.accessTokenExpiresAt ?? null,
    refreshToken: account.refreshToken ?? null,
    refreshTokenExpiresAt: account.refreshTokenExpiresAt ?? null,
  };
}

/**
 * Refresh Microsoft OAuth access token using refresh token
 */
async function refreshMicrosoftToken(
  ctx: ActionCtx,
  refreshToken: string,
  accountId: string,
): Promise<{ accessToken: string; expiresAt: number } | null> {
  const tenantId = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
  const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    console.error('refreshMicrosoftToken: Missing OAuth credentials');
    return null;
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
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('refreshMicrosoftToken: Token refresh failed:', errorText);
    return null;
  }

  const data = await response.json();
  const expiresAt = Date.now() + data.expires_in * 1000;

  // Update tokens in Better Auth via internal mutation
  await ctx.runMutation(internal.onedrive.updateMicrosoftTokensInternal, {
    accountId,
    accessToken: data.access_token,
    accessTokenExpiresAt: expiresAt,
    refreshToken: data.refresh_token || refreshToken,
    refreshTokenExpiresAt: data.refresh_token_expires_in
      ? Date.now() + data.refresh_token_expires_in * 1000
      : null,
  });

  return {
    accessToken: data.access_token,
    expiresAt,
  };
}

/**
 * Get a valid Microsoft Graph access token (refreshing if needed)
 */
async function getMicrosoftGraphToken(ctx: ActionCtx): Promise<string | null> {
  const account = await getMicrosoftAccountInternal(ctx);
  if (!account) {
    return null;
  }

  if (!account.accessToken) {
    return null;
  }

  // Check if token is expired (with 5-minute buffer)
  if (account.accessTokenExpiresAt) {
    const bufferMs = 5 * 60 * 1000;
    if (account.accessTokenExpiresAt < Date.now() + bufferMs) {
      // Token expired or expiring soon, try to refresh
      if (account.refreshToken) {
        const refreshed = await refreshMicrosoftToken(
          ctx,
          account.refreshToken,
          account.accountId,
        );
        if (refreshed) {
          return refreshed.accessToken;
        }
      }
      return null;
    }
  }

  return account.accessToken;
}

// =============================================================================
// INTERNAL MUTATIONS
// =============================================================================

/**
 * Update Microsoft tokens (internal mutation)
 */
export const updateMicrosoftTokensInternal = internalMutation({
  args: {
    accountId: v.string(),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
    refreshToken: v.string(),
    refreshTokenExpiresAt: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'account' as const,
        where: [{ field: 'accountId', value: args.accountId, operator: 'eq' }],
        update: {
          accessToken: args.accessToken,
          accessTokenExpiresAt: args.accessTokenExpiresAt,
          refreshToken: args.refreshToken,
          ...(args.refreshTokenExpiresAt && {
            refreshTokenExpiresAt: args.refreshTokenExpiresAt,
          }),
          updatedAt: Date.now(),
        },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });
    return null;
  },
});

// =============================================================================
// PUBLIC ACTIONS
// =============================================================================

/**
 * List files and folders from OneDrive
 */
export const listFiles = action({
  args: {
    folderId: v.optional(v.string()),
    pageSize: v.optional(v.number()),
    nextLink: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    data: v.optional(driveItemsResponseValidator),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const identity = await ctx.auth.getUserIdentity();
      if (identity) {
        await checkUserRateLimit(ctx, 'external:onedrive-list', identity.subject);
      }

      const token = await getMicrosoftGraphToken(ctx);
      if (!token) {
        return {
          success: false,
          error: 'Microsoft account not connected. Please sign in with Microsoft.',
        };
      }

      const baseUrl = 'https://graph.microsoft.com/v1.0';
      const pageSize = args.pageSize || 50;
      const selectFields =
        'id,name,size,createdDateTime,lastModifiedDateTime,webUrl,file,folder,parentReference';

      const url = args.nextLink
        ? args.nextLink
        : args.folderId
          ? `${baseUrl}/me/drive/items/${args.folderId}/children?$top=${pageSize}&$select=${selectFields}`
          : `${baseUrl}/me/drive/root/children?$top=${pageSize}&$select=${selectFields}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401) {
          return {
            success: false,
            error: 'Microsoft account authentication expired. Please reconnect.',
          };
        }
        if (response.status === 403) {
          return {
            success: false,
            error: 'Permission denied. Please grant access to OneDrive files.',
          };
        }
        throw new Error(`Microsoft Graph API error: ${response.status} ${errorText}`);
      }

      const data: DriveItemsResponse = await response.json();

      // Strip OData metadata fields from each item
      const cleanedItems = data.value.map((item) => ({
        id: item.id,
        name: item.name,
        size: item.size,
        createdDateTime: item.createdDateTime,
        lastModifiedDateTime: item.lastModifiedDateTime,
        webUrl: item.webUrl,
        downloadUrl: item.downloadUrl,
        file: item.file,
        folder: item.folder,
        parentReference: item.parentReference,
      }));

      return {
        success: true,
        data: {
          nextLink: data['@odata.nextLink'],
          value: cleanedItems,
        },
      };
    } catch (error) {
      console.error('Error listing OneDrive files:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list OneDrive files',
      };
    }
  },
});

/**
 * Read file content from OneDrive
 */
export const readFile = action({
  args: {
    fileId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    data: v.optional(
      v.object({
        content: v.bytes(),
        mimeType: v.string(),
        size: v.number(),
      }),
    ),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const identity = await ctx.auth.getUserIdentity();
      if (identity) {
        await checkUserRateLimit(ctx, 'external:onedrive-read', identity.subject);
      }

      const token = await getMicrosoftGraphToken(ctx);
      if (!token) {
        return {
          success: false,
          error: 'Microsoft account not connected. Please sign in with Microsoft.',
        };
      }

      const baseUrl = 'https://graph.microsoft.com/v1.0';
      const url = `${baseUrl}/me/drive/items/${args.fileId}/content`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return {
            success: false,
            error: 'Microsoft account authentication expired. Please reconnect.',
          };
        }
        if (response.status === 403) {
          return {
            success: false,
            error: 'Permission denied. Please grant access to OneDrive files.',
          };
        }
        if (response.status === 404) {
          return {
            success: false,
            error: 'File not found.',
          };
        }
        const errorText = await response.text();
        throw new Error(`Microsoft Graph API error: ${response.status} ${errorText}`);
      }

      const arrayBuffer = await response.arrayBuffer();

      return {
        success: true,
        data: {
          content: arrayBuffer,
          mimeType: 'application/octet-stream',
          size: arrayBuffer.byteLength,
        },
      };
    } catch (error) {
      console.error('Error reading OneDrive file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read file',
      };
    }
  },
});

/**
 * Search files in OneDrive
 */
export const searchFiles = action({
  args: {
    query: v.string(),
    pageSize: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    data: v.optional(driveItemsResponseValidator),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const identity = await ctx.auth.getUserIdentity();
      if (identity) {
        await checkUserRateLimit(ctx, 'external:onedrive-search', identity.subject);
      }

      if (!args.query || args.query.trim().length === 0) {
        return {
          success: false,
          error: 'Search query cannot be empty',
        };
      }

      const token = await getMicrosoftGraphToken(ctx);
      if (!token) {
        return {
          success: false,
          error: 'Microsoft account not connected. Please sign in with Microsoft.',
        };
      }

      const baseUrl = 'https://graph.microsoft.com/v1.0';
      const url = `${baseUrl}/me/drive/root/search(q='${encodeURIComponent(args.query)}')`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return {
            success: false,
            error: 'Microsoft account authentication expired. Please reconnect.',
          };
        }
        if (response.status === 403) {
          return {
            success: false,
            error: 'Permission denied. Please grant access to OneDrive files.',
          };
        }
        const errorText = await response.text();
        throw new Error(`Microsoft Graph API error: ${response.status} ${errorText}`);
      }

      const data: DriveItemsResponse = await response.json();

      return {
        success: true,
        data: {
          nextLink: data['@odata.nextLink'],
          value: data.value,
        },
      };
    } catch (error) {
      console.error('Error searching OneDrive files:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search files',
      };
    }
  },
});

// =============================================================================
// INTERNAL QUERIES (for workflow actions)
// =============================================================================

/**
 * Get Microsoft account for a specific user by userId (internal)
 */
async function getMicrosoftAccountByUserIdInternal(
  ctx: QueryCtx,
  userId: string,
): Promise<MicrosoftAccount | null> {
  // Get Better Auth user by id
  const authUsers = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'user',
      where: [{ field: '_id', value: userId, operator: 'eq' }],
      paginationOpts: { cursor: null, numItems: 1 },
    },
  );

  if (!authUsers?.page?.length) {
    return null;
  }

  const authUser = authUsers.page[0];

  // Get Microsoft account
  const microsoftResult = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'account',
      where: [
        { field: 'userId', value: String(authUser._id), operator: 'eq' },
        { field: 'providerId', value: 'microsoft', operator: 'eq' },
      ],
      paginationOpts: { cursor: null, numItems: 1 },
    },
  );

  const microsoftAccounts = microsoftResult?.page || [];
  if (microsoftAccounts.length === 0) {
    return null;
  }

  const account = microsoftAccounts[0];
  return {
    accountId: account.accountId,
    userId: account.userId,
    providerId: account.providerId,
    accessToken: account.accessToken ?? null,
    accessTokenExpiresAt: account.accessTokenExpiresAt ?? null,
    refreshToken: account.refreshToken ?? null,
    refreshTokenExpiresAt: account.refreshTokenExpiresAt ?? null,
  };
}

/**
 * Get Microsoft Graph token for a specific user (internal query for workflow actions)
 */
export const getUserMicrosoftGraphToken = internalQuery({
  args: {
    userId: v.string(),
  },
  returns: v.object({
    token: v.union(v.string(), v.null()),
    needsRefresh: v.boolean(),
    accountId: v.union(v.string(), v.null()),
    refreshToken: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const account = await getMicrosoftAccountByUserIdInternal(ctx, args.userId);
    if (!account) {
      return {
        token: null,
        needsRefresh: false,
        accountId: null,
        refreshToken: null,
      };
    }

    if (!account.accessToken) {
      return {
        token: null,
        needsRefresh: true,
        accountId: account.accountId,
        refreshToken: account.refreshToken,
      };
    }

    // Check if token is expired (with 5-minute buffer)
    const bufferMs = 5 * 60 * 1000;
    const needsRefresh = account.accessTokenExpiresAt
      ? account.accessTokenExpiresAt < Date.now() + bufferMs
      : false;

    return {
      token: needsRefresh ? null : account.accessToken,
      needsRefresh,
      accountId: account.accountId,
      refreshToken: account.refreshToken,
    };
  },
});

// =============================================================================
// INTERNAL ACTIONS (for workflow actions)
// =============================================================================

/**
 * Refresh Microsoft Graph token (internal action for workflow actions)
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
    const tenantId = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
    const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
    const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      return {
        success: false,
        error: 'Missing OAuth credentials',
      };
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
      return {
        success: false,
        error: `Token refresh failed: ${errorText}`,
      };
    }

    const data = await response.json();
    const expiresAt = Date.now() + data.expires_in * 1000;

    // Update tokens
    await ctx.runMutation(internal.onedrive.updateMicrosoftTokensInternal, {
      accountId: args.accountId,
      accessToken: data.access_token,
      accessTokenExpiresAt: expiresAt,
      refreshToken: data.refresh_token || args.refreshToken,
      refreshTokenExpiresAt: data.refresh_token_expires_in
        ? Date.now() + data.refresh_token_expires_in * 1000
        : null,
    });

    return {
      success: true,
      accessToken: data.access_token,
    };
  },
});

/**
 * Read file from OneDrive using provided token (internal action for workflow actions)
 */
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
    try {
      const baseUrl = 'https://graph.microsoft.com/v1.0';
      const url = `${baseUrl}/me/drive/items/${args.itemId}/content`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${args.token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return {
            success: false,
            error: 'Token expired or invalid',
          };
        }
        const errorText = await response.text();
        return {
          success: false,
          error: `Microsoft Graph API error: ${response.status} ${errorText}`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();

      return {
        success: true,
        content: arrayBuffer,
        mimeType: response.headers.get('content-type') || 'application/octet-stream',
        size: arrayBuffer.byteLength,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read file',
      };
    }
  },
});

/**
 * List folder contents from OneDrive using provided token (internal action for workflow actions)
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
          isFolder: v.boolean(),
        }),
      ),
    ),
    error: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => {
    try {
      const baseUrl = 'https://graph.microsoft.com/v1.0';
      const url = `${baseUrl}/me/drive/items/${args.itemId}/children`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${args.token}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return {
            success: false,
            error: 'Token expired or invalid',
          };
        }
        const errorText = await response.text();
        return {
          success: false,
          error: `Microsoft Graph API error: ${response.status} ${errorText}`,
        };
      }

      const data: DriveItemsResponse = await response.json();

      const files = data.value.map((item) => ({
        id: item.id,
        name: item.name,
        size: item.size || 0,
        mimeType: item.file?.mimeType,
        lastModified: item.lastModifiedDateTime
          ? new Date(item.lastModifiedDateTime).getTime()
          : undefined,
        isFolder: !!item.folder,
      }));

      return {
        success: true,
        files,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list folder contents',
      };
    }
  },
});

/**
 * Upload file to Convex storage (internal action for workflow actions)
 */
export const uploadToStorage = internalAction({
  args: {
    organizationId: v.string(),
    fileName: v.string(),
    fileData: v.bytes(),
    contentType: v.string(),
    metadata: v.optional(v.any()),
    documentIdToUpdate: v.optional(v.id('documents')),
    createdBy: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    fileId: v.optional(v.string()),
    documentId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      // Store the file in Convex storage
      const fileId = await ctx.storage.store(
        new Blob([args.fileData], { type: args.contentType }),
      );

      // Build document metadata
      const documentMetadata = {
        name: args.fileName,
        type: 'file' as const,
        lastModified: Date.now(),
        ...args.metadata,
      };

      if (args.documentIdToUpdate) {
        // Update existing document
        await ctx.runMutation(internal.documents.updateDocumentInternal, {
          documentId: args.documentIdToUpdate,
          title: args.fileName,
          fileId: fileId,
          mimeType: args.contentType,
          metadata: documentMetadata,
        });

        return {
          success: true,
          fileId,
          documentId: args.documentIdToUpdate,
        };
      }

      // Create new document record
      const result: { success: boolean; documentId: Id<'documents'> } =
        await ctx.runMutation(internal.documents.createDocument, {
          organizationId: args.organizationId,
          title: args.fileName,
          sourceProvider: 'onedrive',
          fileId: fileId,
          mimeType: args.contentType,
          metadata: documentMetadata,
          createdBy: args.createdBy,
        });

      return {
        success: true,
        fileId,
        documentId: result.documentId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  },
});

/**
 * Update OneDrive sync configuration (internal mutation for workflow actions)
 */
export const updateSyncConfig = internalMutation({
  args: {
    configId: v.id('onedriveSyncConfigs'),
    status: v.optional(syncConfigStatusValidator),
    lastSyncAt: v.optional(v.number()),
    lastSyncStatus: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const updateFields: Record<string, unknown> = {};

    if (args.status !== undefined) {
      updateFields.status = args.status;
    }
    if (args.lastSyncAt !== undefined) {
      updateFields.lastSyncAt = args.lastSyncAt;
    }
    if (args.lastSyncStatus !== undefined) {
      updateFields.lastSyncStatus = args.lastSyncStatus;
    }
    if (args.errorMessage !== undefined) {
      updateFields.errorMessage = args.errorMessage;
    }

    updateFields.updatedAt = Date.now();

    await ctx.db.patch(args.configId, updateFields);
    return null;
  },
});

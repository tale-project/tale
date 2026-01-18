'use node';

/**
 * OneDrive Public Actions
 */

import { v } from 'convex/values';
import { action } from '../_generated/server';
import { internal } from '../_generated/api';
import { authComponent } from '../auth';

const oneDriveItemValidator = v.object({
  id: v.string(),
  name: v.string(),
  size: v.number(),
  isFolder: v.boolean(),
  mimeType: v.optional(v.string()),
  lastModified: v.optional(v.number()),
  childCount: v.optional(v.number()),
  webUrl: v.optional(v.string()),
});

export const listFiles = action({
  args: {
    folderId: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    items: v.optional(v.array(oneDriveItemValidator)),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return { success: false, error: 'Unauthenticated' };
    }

    const userId = String(authUser._id);

    try {
      // Get Microsoft Graph token
      const tokenResult: {
        token?: string;
        needsRefresh?: boolean;
        accountId?: string;
        refreshToken?: string;
      } = await ctx.runQuery(
        internal.onedrive.queries.getUserToken,
        { userId },
      );

      if (tokenResult.needsRefresh && tokenResult.accountId && tokenResult.refreshToken) {
        // Refresh the token
        await ctx.runAction(internal.onedrive.internal_actions.refreshToken, {
          accountId: tokenResult.accountId,
          refreshToken: tokenResult.refreshToken,
        });

        // Get the new token
        const newTokenResult: { token?: string } = await ctx.runQuery(
          internal.onedrive.queries.getUserToken,
          { userId },
        );

        if (!newTokenResult.token) {
          return { success: false, error: 'Failed to refresh OneDrive token' };
        }

        return await fetchOneDriveFiles(newTokenResult.token, args.folderId, args.search);
      }

      if (!tokenResult.token) {
        return { success: false, error: 'OneDrive not connected. Please connect your Microsoft account.' };
      }

      return await fetchOneDriveFiles(tokenResult.token, args.folderId, args.search);
    } catch (error) {
      console.error('[listFiles] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

async function fetchOneDriveFiles(
  token: string,
  folderId?: string,
  search?: string,
): Promise<{
  success: boolean;
  items?: Array<{
    id: string;
    name: string;
    size: number;
    isFolder: boolean;
    mimeType?: string;
    lastModified?: number;
    childCount?: number;
    webUrl?: string;
  }>;
  error?: string;
}> {
  try {
    let url: string;

    if (search) {
      // Search endpoint
      url = `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(search)}')?$top=50`;
    } else if (folderId) {
      // List folder children
      url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?$top=100`;
    } else {
      // List root children
      url = `https://graph.microsoft.com/v1.0/me/drive/root/children?$top=100`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `OneDrive API error: ${response.status} ${errorText}`,
      };
    }

    const data = await response.json() as {
      value: Array<{
        id: string;
        name: string;
        size: number;
        file?: { mimeType?: string };
        folder?: { childCount?: number };
        lastModifiedDateTime?: string;
        webUrl?: string;
      }>;
    };

    const items = data.value.map((item) => ({
      id: item.id,
      name: item.name,
      size: item.size || 0,
      isFolder: item.folder !== undefined,
      mimeType: item.file?.mimeType,
      lastModified: item.lastModifiedDateTime ? Date.parse(item.lastModifiedDateTime) : undefined,
      childCount: item.folder?.childCount,
      webUrl: item.webUrl,
    }));

    return { success: true, items };
  } catch (error) {
    console.error('[fetchOneDriveFiles] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

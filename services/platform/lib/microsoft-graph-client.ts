/**
 * Microsoft Graph API Client
 *
 * This utility provides methods to interact with Microsoft Graph API
 * using Better Auth stored OAuth tokens.
 *
 * IMPLEMENTATION:
 * - Token retrieval from Better Auth accounts via Convex (see getMicrosoftGraphToken)
 * - Automatic token refresh when expired (see refreshMicrosoftToken)
 * - Uses Microsoft Graph SDK (@microsoft/microsoft-graph-client)
 *
 * ARCHITECTURE:
 * Server Actions (in /actions/onedrive/) use this client to access user-specific
 * OneDrive files. The client retrieves Microsoft Graph access tokens from Better
 * Auth's stored account data and handles token refresh automatically.
 */

import type { DriveItemsResponse } from '@/types/microsoft-graph';
import { getCurrentUser, getAuthToken } from './auth/auth-server';
import { fetchQuery, fetchMutation } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';

export class MicrosoftGraphClient {
  private baseUrl = 'https://graph.microsoft.com/v1.0';

  constructor(private accessToken: string) {}

  /**
   * List files and folders from OneDrive
   */
  async listFiles(options: {
    folderId?: string;
    pageSize?: number;
    nextLink?: string;
  }): Promise<DriveItemsResponse> {
    const { folderId, pageSize = 50, nextLink } = options;

    const url = nextLink
      ? nextLink
      : folderId
        ? `${this.baseUrl}/me/drive/items/${folderId}/children?$top=${pageSize}`
        : `${this.baseUrl}/me/drive/root/children?$top=${pageSize}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Microsoft Graph API error: ${response.status} ${errorText}`,
      );
    }

    return response.json();
  }

  /**
   * Read file content from OneDrive
   */
  async readFile(fileId: string): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/me/drive/items/${fileId}/content`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Microsoft Graph API error: ${response.status} ${errorText}`,
      );
    }

    return response.arrayBuffer();
  }

  /**
   * Search files in OneDrive
   */
  async searchFiles(query: string): Promise<DriveItemsResponse> {
    const url = `${this.baseUrl}/me/drive/root/search(q='${encodeURIComponent(query)}')`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Microsoft Graph API error: ${response.status} ${errorText}`,
      );
    }

    return response.json();
  }
}

/**
 * Get Microsoft Graph access token from Better Auth
 *
 * Retrieves the Microsoft OAuth access token stored by Better Auth
 * for the currently authenticated user.
 *
 * @returns The Microsoft Graph access token, or null if not available
 * @throws Error if user is not authenticated
 */
export async function getMicrosoftGraphToken(): Promise<string | null> {
  try {
    // Get current user to ensure authentication
    const user = await getCurrentUser();
    if (!user) {
      console.warn('getMicrosoftGraphToken: User not authenticated');
      return null;
    }

    // Get Better Auth session token for Convex queries
    const sessionToken = await getAuthToken();
    if (!sessionToken) {
      console.warn('getMicrosoftGraphToken: No session token available');
      return null;
    }

    // Query Convex for Microsoft OAuth account
    const microsoftAccount = await fetchQuery(
      api.accounts.getMicrosoftAccount,
      {},
      { token: sessionToken },
    );

    if (!microsoftAccount) {
      console.warn(
        'getMicrosoftGraphToken: No Microsoft account connected for user',
      );
      return null;
    }

    // Check if access token exists
    if (!microsoftAccount.accessToken) {
      console.warn('getMicrosoftGraphToken: No access token available');
      return null;
    }

    // Check if token is expired
    if (microsoftAccount.accessTokenExpiresAt) {
      const now = Date.now(); // Keep in milliseconds
      const bufferMs = 5 * 60 * 1000; // 5 minutes in milliseconds

      if (microsoftAccount.accessTokenExpiresAt < now + bufferMs) {
        console.warn(
          'getMicrosoftGraphToken: Access token expired, attempting refresh',
        );

        // Attempt to refresh the token
        if (microsoftAccount.refreshToken) {
          const refreshed = await refreshMicrosoftToken(
            microsoftAccount.refreshToken,
            microsoftAccount.accountId,
          );

          if (refreshed) {
            // Return the new access token
            return refreshed.accessToken;
          }
        }

        // If refresh failed or no refresh token, return null
        console.error('getMicrosoftGraphToken: Token refresh failed');
        return null;
      }
    }

    return microsoftAccount.accessToken;
  } catch (error) {
    console.error(
      'getMicrosoftGraphToken: Error retrieving Microsoft Graph token:',
      error,
    );
    return null;
  }
}

/**
 * Refresh Microsoft OAuth access token using refresh token
 */
async function refreshMicrosoftToken(
  refreshToken: string,
  accountId: string,
): Promise<{ accessToken: string; expiresAt: number } | null> {
  try {
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
    const expiresAt = Date.now() + data.expires_in * 1000; // Convert seconds to milliseconds

    // Update tokens in Better Auth via Convex
    const sessionToken = await getAuthToken();
    if (sessionToken) {
      await fetchMutation(
        api.accounts.refreshAndUpdateTokens,
        {
          accountId,
          accessToken: data.access_token,
          accessTokenExpiresAt: expiresAt,
          refreshToken: data.refresh_token || refreshToken, // Use new refresh token if provided
          refreshTokenExpiresAt: data.refresh_token_expires_in
            ? Date.now() + data.refresh_token_expires_in * 1000
            : null,
        },
        { token: sessionToken },
      );
    }

    return {
      accessToken: data.access_token,
      expiresAt,
    };
  } catch (error) {
    console.error('refreshMicrosoftToken: Error refreshing token:', error);
    return null;
  }
}

/**
 * Check if the current user has a Microsoft account connected
 *
 * @returns True if user has Microsoft OAuth account, false otherwise
 */
export async function hasMicrosoftAccount(): Promise<boolean> {
  try {
    const token = await getMicrosoftGraphToken();
    return token !== null;
  } catch {
    return false;
  }
}

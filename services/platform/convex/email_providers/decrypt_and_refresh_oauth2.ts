/**
 * Business logic for decrypting and refreshing OAuth2 tokens
 */

import type { ActionCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';

import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_OAUTH2', '[OAuth2]');

export interface OAuth2TokenRefreshResult {
  accessToken: string;
  wasRefreshed: boolean;
}

export interface OAuth2Provider {
  provider: string;
  clientId: string;
  clientSecretEncrypted: string;
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string;
  tokenExpiry?: number;
  tokenUrl?: string; // Tenant-specific token URL for Microsoft
}

/**
 * Decrypt and potentially refresh OAuth2 access token
 * Returns the decrypted access token, refreshing it first if needed
 */
export async function decryptAndRefreshOAuth2Token(
  ctx: ActionCtx,
  providerId: Doc<'emailProviders'>['_id'],
  oauth2Auth: OAuth2Provider,
  decryptAction: (jwe: string) => Promise<string>,
  refreshTokenAction: (params: {
    provider: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    tokenUrl?: string;
  }) => Promise<{
    accessToken: string;
    refreshToken?: string;
    tokenType: string;
    expiresIn?: number;
    scope?: string;
  }>,
  storeTokensAction: (params: {
    emailProviderId: Doc<'emailProviders'>['_id'];
    accessToken: string;
    refreshToken?: string;
    tokenType: string;
    expiresIn?: number;
    scope?: string;
  }) => Promise<unknown>,
): Promise<OAuth2TokenRefreshResult> {
  // Check if we have an access token
  if (!oauth2Auth.accessTokenEncrypted) {
    throw new Error(
      'OAuth2 provider not authorized yet. Please complete the OAuth2 authorization flow first by clicking "Authorize" or "Connect".',
    );
  }

  // Check if token is expired and refresh if needed
  const currentTime = Math.floor(Date.now() / 1000);
  const tokenExpiry = oauth2Auth.tokenExpiry;
  const needsRefresh = tokenExpiry && currentTime >= tokenExpiry - 300; // Refresh if expires in < 5 minutes

  if (needsRefresh && oauth2Auth.refreshTokenEncrypted) {
    debugLog(
      `OAuth2 token expired or expiring soon for provider ${providerId}, refreshing...`,
    );

    // Decrypt refresh token and client secret
    let refreshToken: string;
    let clientSecret: string;

    try {
      refreshToken = await decryptAction(oauth2Auth.refreshTokenEncrypted);
    } catch (error) {
      console.error('Failed to decrypt refresh token:', error);
      throw new Error(
        'Failed to decrypt refresh token. This usually means the ENCRYPTION_SECRET environment variable is missing or has changed. Please check your Convex environment variables or re-authorize the provider.',
      );
    }

    try {
      clientSecret = await decryptAction(oauth2Auth.clientSecretEncrypted);
    } catch (error) {
      console.error('Failed to decrypt client secret:', error);
      throw new Error(
        'Failed to decrypt client secret. This usually means the ENCRYPTION_SECRET environment variable is missing or has changed. Please check your Convex environment variables or re-authorize the provider.',
      );
    }

    // Refresh the token
    try {
      const newTokens = await refreshTokenAction({
        provider: oauth2Auth.provider,
        clientId: oauth2Auth.clientId,
        clientSecret: clientSecret,
        refreshToken: refreshToken,
        tokenUrl: oauth2Auth.tokenUrl,
      });

      // Store new tokens
      await storeTokensAction({
        emailProviderId: providerId,
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        tokenType: newTokens.tokenType,
        expiresIn: newTokens.expiresIn,
        scope: newTokens.scope,
      });

      debugLog(
        `✓ Successfully refreshed OAuth2 token for provider ${providerId}`,
      );

      return {
        accessToken: newTokens.accessToken,
        wasRefreshed: true,
      };
    } catch (error) {
      console.error(
        `Failed to refresh OAuth2 token for provider ${providerId}:`,
        error,
      );
      throw new Error(
        'Failed to refresh OAuth2 token. Please re-authorize the provider by clicking "Authorize" or "Connect".',
      );
    }
  } else {
    // Token is still valid, decrypt it
    try {
      const accessToken = await decryptAction(oauth2Auth.accessTokenEncrypted);
      return {
        accessToken,
        wasRefreshed: false,
      };
    } catch (error) {
      console.error('Failed to decrypt access token:', error);
      throw new Error(
        'Failed to decrypt access token. This usually means the ENCRYPTION_SECRET environment variable is missing or has changed. Please check your Convex environment variables in the dashboard, or re-authorize the provider.',
      );
    }
  }
}

/**
 * Decrypt password authentication credentials
 */
export async function decryptPasswordAuth(
  passwordAuth: { user: string; passEncrypted: string },
  decryptAction: (jwe: string) => Promise<string>,
): Promise<{ user: string; pass: string }> {
  try {
    const decryptedPass = await decryptAction(passwordAuth.passEncrypted);
    return {
      user: passwordAuth.user,
      pass: decryptedPass,
    };
  } catch (error) {
    console.error('Failed to decrypt password:', error);
    throw new Error(
      'Failed to decrypt password. This usually means the ENCRYPTION_SECRET environment variable is missing or has changed. Please check your Convex environment variables in the dashboard.',
    );
  }
}

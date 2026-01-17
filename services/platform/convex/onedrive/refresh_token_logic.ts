/**
 * Refresh Token Logic - Business logic for refreshing Microsoft Graph tokens
 */

import type { ActionCtx, MutationCtx } from '../_generated/server';
import * as MicrosoftAccountsModel from '../accounts/helpers';

export interface RefreshTokenResult {
  success: boolean;
  accessToken?: string;
  error?: string;
}

export interface RefreshTokenDependencies {
  runMutation: ActionCtx['runMutation'];
  updateTokens: (
    ctx: MutationCtx,
    args: {
      accountId: string;
      accessToken: string;
      accessTokenExpiresAt: number;
      refreshToken?: string;
      refreshTokenExpiresAt?: number | null;
    },
  ) => Promise<void>;
}

/**
 * Refresh Microsoft Graph token using refresh token
 * Makes external API call to Microsoft OAuth endpoint
 */
export async function refreshTokenLogic(
  args: {
    accountId: string;
    refreshToken: string;
  },
  deps: RefreshTokenDependencies,
): Promise<RefreshTokenResult> {
  try {
    const tenantId = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
    const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
    const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      console.error('refreshTokenLogic: Missing OAuth credentials');
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
      console.error('refreshTokenLogic: Token refresh failed:', errorText);
      return {
        success: false,
        error: `Token refresh failed: ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
    };

    const expiresAt = Date.now() + data.expires_in * 1000; // Convert seconds to milliseconds

    // Update tokens via dependency injection
    // This will be called with the appropriate mutation context
    await deps.updateTokens(
      // The mutation context will be provided by the caller
      {} as MutationCtx,
      {
        accountId: args.accountId,
        accessToken: data.access_token,
        accessTokenExpiresAt: expiresAt,
        refreshToken: data.refresh_token || args.refreshToken, // Use new refresh token if provided
        refreshTokenExpiresAt: data.refresh_token_expires_in
          ? Date.now() + data.refresh_token_expires_in * 1000
          : null,
      },
    );

    return {
      success: true,
      accessToken: data.access_token,
    };
  } catch (error) {
    console.error('refreshTokenLogic: Error refreshing token:', error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unknown error refreshing token',
    };
  }
}

/**
 * Update Microsoft account tokens
 * Wrapper around the Microsoft accounts model
 */
export async function updateMicrosoftTokensLogic(
  ctx: MutationCtx,
  args: {
    accountId: string;
    accessToken: string;
    accessTokenExpiresAt: number;
    refreshToken?: string;
    refreshTokenExpiresAt?: number | null;
  },
): Promise<void> {
  await MicrosoftAccountsModel.updateMicrosoftTokens(ctx, args);
}


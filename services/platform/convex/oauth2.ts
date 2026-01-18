'use node';

/**
 * OAuth2 Public Actions
 *
 * Provides OAuth2 token refresh and user email retrieval actions.
 */

import { v } from 'convex/values';
import { action } from './_generated/server';

interface RefreshTokenResult {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
  scope?: string;
}

export const refreshToken = action({
  args: {
    provider: v.string(),
    clientId: v.string(),
    clientSecret: v.string(),
    refreshToken: v.string(),
    scope: v.optional(v.string()),
    accountType: v.optional(
      v.union(
        v.literal('personal'),
        v.literal('organizational'),
        v.literal('both'),
      ),
    ),
    tokenUrl: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<RefreshTokenResult> => {
    let tokenUrl: string;
    let body: URLSearchParams;

    if (args.provider === 'google' || args.provider === 'gmail') {
      tokenUrl = 'https://oauth2.googleapis.com/token';
      body = new URLSearchParams({
        client_id: args.clientId,
        client_secret: args.clientSecret,
        refresh_token: args.refreshToken,
        grant_type: 'refresh_token',
      });
    } else if (
      args.provider === 'microsoft' ||
      args.provider === 'outlook' ||
      args.provider === 'microsoft-entra-id'
    ) {
      tokenUrl =
        args.tokenUrl ||
        'https://login.microsoftonline.com/common/oauth2/v2.0/token';
      body = new URLSearchParams({
        client_id: args.clientId,
        client_secret: args.clientSecret,
        refresh_token: args.refreshToken,
        grant_type: 'refresh_token',
        ...(args.scope ? { scope: args.scope } : {}),
      });
    } else {
      throw new Error(`Unsupported OAuth2 provider: ${args.provider}`);
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OAuth2 token refresh failed:', errorText);
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type: string;
      expires_in?: number;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      scope: data.scope,
    };
  },
});

export const getUserEmail = action({
  args: {
    provider: v.string(),
    accessToken: v.string(),
  },
  handler: async (_ctx, args): Promise<string> => {
    let email: string | undefined;

    if (args.provider === 'google' || args.provider === 'gmail') {
      const response = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: {
            Authorization: `Bearer ${args.accessToken}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to get Google user info: ${response.status}`);
      }

      const data = (await response.json()) as { email?: string };
      email = data.email;
    } else if (
      args.provider === 'microsoft' ||
      args.provider === 'outlook' ||
      args.provider === 'microsoft-entra-id'
    ) {
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to get Microsoft user info: ${response.status}`,
        );
      }

      const data = (await response.json()) as {
        mail?: string;
        userPrincipalName?: string;
      };
      email = data.mail || data.userPrincipalName;
    } else {
      throw new Error(`Unsupported OAuth2 provider: ${args.provider}`);
    }

    if (!email) {
      throw new Error('Could not retrieve user email from OAuth2 provider');
    }

    return email;
  },
});

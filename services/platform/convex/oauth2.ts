'use node';

/**
 * OAuth2 Internal Actions
 *
 * Provides OAuth2 token refresh and user email retrieval actions.
 * These are internal-only to prevent abuse as a token refresh proxy.
 */

import { v } from 'convex/values';

import { fetchJson } from '../lib/utils/type-cast-helpers';
import { internalAction } from './_generated/server';

interface RefreshTokenResult {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
  scope?: string;
}

export const refreshToken = internalAction({
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
      // Use tenant-specific endpoint based on account type
      // personal -> consumers, organizational -> organizations, both/undefined -> common
      const tenantType =
        args.accountType === 'personal'
          ? 'consumers'
          : args.accountType === 'organizational'
            ? 'organizations'
            : 'common';
      tokenUrl =
        args.tokenUrl ||
        `https://login.microsoftonline.com/${tenantType}/oauth2/v2.0/token`;
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
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OAuth2 token refresh failed:', errorText);
      throw new Error(
        `Token refresh failed: ${response.status} - ${errorText}`,
      );
    }

    const data = await fetchJson<{
      access_token: string;
      refresh_token?: string;
      token_type: string;
      expires_in?: number;
      scope?: string;
    }>(response);

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      scope: data.scope,
    };
  },
});

export const getUserEmail = internalAction({
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
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to get Google user info: ${response.status}`);
      }

      const data = await fetchJson<{ email?: string }>(response);
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
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to get Microsoft user info: ${response.status}`,
        );
      }

      const data = await fetchJson<{
        mail?: string;
        userPrincipalName?: string;
      }>(response);
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

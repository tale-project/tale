'use node';

/**
 * Decrypt a user cloud-import grant and refresh when near expiry.
 * Only for Knowledge paths owned by that user — never agent resolution.
 */

import { v } from 'convex/values';

import { getNumber, getString, isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import {
  parseSecretPayload,
  type ConnectorSecretPayload,
} from '../connector_credentials/auth_injection';
import { decryptSecret, encryptSecret } from '../lib/secret_box';
import {
  microsoftCloudImportOauthUrls,
  resolveCloudImportOauthApp,
  resolveMicrosoftCloudImportTenantId,
} from './deployment_config';
import { getCloudImportProviderEndpoints } from './providers';
import { cloudImportProviderValidator } from './schema';

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export type ResolveCloudTokenResult =
  | { success: true; accessToken: string }
  | { success: false; error: string; needsReauth?: boolean };

function parseOAuthTokenResponse(data: unknown): {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
} | null {
  if (!isRecord(data)) return null;
  const accessToken = getString(data, 'access_token');
  if (accessToken === undefined) return null;
  const refreshToken = getString(data, 'refresh_token');
  const expiresIn = getNumber(data, 'expires_in');
  return {
    accessToken,
    ...(refreshToken !== undefined && { refreshToken }),
    ...(expiresIn !== undefined && {
      expiresAt: Date.now() + expiresIn * 1000,
    }),
  };
}

async function refreshMicrosoftAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
}): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
} | null> {
  const { tokenUrl } = microsoftCloudImportOauthUrls(args.tenantId);
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      refresh_token: args.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) return null;
  return parseOAuthTokenResponse(await response.json());
}

async function refreshGoogleAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
} | null> {
  const { tokenUrl } = getCloudImportProviderEndpoints('google-drive');
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      refresh_token: args.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) return null;
  return parseOAuthTokenResponse(await response.json());
}

export const resolveAccessToken = internalAction({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    provider: cloudImportProviderValidator,
  },
  returns: v.union(
    v.object({ success: v.literal(true), accessToken: v.string() }),
    v.object({
      success: v.literal(false),
      error: v.string(),
      needsReauth: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, args): Promise<ResolveCloudTokenResult> => {
    const row = await ctx.runQuery(
      internal.cloud_import.queries.getAuthorizationInternal,
      {
        organizationId: args.organizationId,
        userId: args.userId,
        provider: args.provider,
      },
    );
    if (!row || row.status === 'needs-reauth') {
      return {
        success: false,
        error: 'Cloud import is not authorized for this provider',
        needsReauth: true,
      };
    }

    let payload: ConnectorSecretPayload;
    try {
      const plaintext = decryptSecret(row.encryptedData);
      payload = parseSecretPayload('oauth2', JSON.parse(plaintext));
    } catch {
      return {
        success: false,
        error: 'Stored cloud authorization could not be decrypted',
        needsReauth: true,
      };
    }
    if (payload.authMethod !== 'oauth2') {
      return { success: false, error: 'Invalid cloud authorization payload' };
    }

    const needsRefresh =
      payload.expiresAt !== undefined &&
      payload.expiresAt < Date.now() + REFRESH_BUFFER_MS;

    if (!needsRefresh) {
      return { success: true, accessToken: payload.accessToken };
    }

    if (!payload.refreshToken) {
      await ctx.runMutation(
        internal.cloud_import.mutations.markNeedsReauthInternal,
        {
          organizationId: args.organizationId,
          userId: args.userId,
          provider: args.provider,
        },
      );
      return {
        success: false,
        error: 'Cloud authorization expired — reconnect to continue',
        needsReauth: true,
      };
    }

    const app = resolveCloudImportOauthApp(args.provider);
    if (!app) {
      return {
        success: false,
        error: 'Cloud import OAuth app is not configured on this deployment',
      };
    }

    let refreshed: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
    } | null = null;

    if (args.provider === 'onedrive') {
      const tenantId = resolveMicrosoftCloudImportTenantId();
      if (!tenantId) {
        return {
          success: false,
          error:
            'Cloud import Microsoft tenant is not configured on this deployment',
        };
      }
      refreshed = await refreshMicrosoftAccessToken({
        refreshToken: payload.refreshToken,
        clientId: app.clientId,
        clientSecret: app.clientSecret,
        tenantId,
      });
    } else if (args.provider === 'google-drive') {
      refreshed = await refreshGoogleAccessToken({
        refreshToken: payload.refreshToken,
        clientId: app.clientId,
        clientSecret: app.clientSecret,
      });
    } else {
      return {
        success: false,
        error: 'Token refresh for this provider is not implemented yet',
        needsReauth: true,
      };
    }

    if (!refreshed) {
      await ctx.runMutation(
        internal.cloud_import.mutations.markNeedsReauthInternal,
        {
          organizationId: args.organizationId,
          userId: args.userId,
          provider: args.provider,
        },
      );
      return {
        success: false,
        error: 'Failed to refresh cloud authorization — reconnect to continue',
        needsReauth: true,
      };
    }

    const nextDocument = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? payload.refreshToken,
      ...(refreshed.expiresAt !== undefined && {
        expiresAt: refreshed.expiresAt,
      }),
      ...(payload.scopes !== undefined && { scopes: [...payload.scopes] }),
    };
    await ctx.runMutation(
      internal.cloud_import.mutations.upsertAuthorizationInternal,
      {
        organizationId: args.organizationId,
        userId: args.userId,
        provider: args.provider,
        encryptedData: encryptSecret(JSON.stringify(nextDocument)),
        scopes: row.scopes,
      },
    );

    return { success: true, accessToken: refreshed.accessToken };
  },
});

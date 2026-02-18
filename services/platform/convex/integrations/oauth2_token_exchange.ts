'use node';

/**
 * OAuth2 token exchange for integrations.
 *
 * Generic authorization_code → token exchange that works with any OAuth2 provider.
 * Uses the integration's oauth2Config.tokenUrl rather than provider-specific logic.
 */

import { v } from 'convex/values';

import { fetchJson } from '../../lib/utils/type-cast-helpers';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { encryptString } from '../lib/crypto/encrypt_string';
import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations OAuth2]');

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
}

export const handleOAuth2Callback = internalAction({
  args: {
    integrationId: v.id('integrations'),
    code: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.runQuery(
      internal.integrations.internal_queries.getInternal,
      { integrationId: args.integrationId },
    );

    if (!integration) {
      throw new Error('Integration not found');
    }

    const oauth2Config = integration.oauth2Config;
    if (!oauth2Config?.clientId || !oauth2Config.clientSecretEncrypted) {
      throw new Error('Integration OAuth2 client credentials not configured');
    }

    const clientSecret = await ctx.runAction(
      internal.lib.crypto.internal_actions.decryptString,
      { jwe: oauth2Config.clientSecretEncrypted },
    );

    const body = new URLSearchParams({
      client_id: oauth2Config.clientId,
      client_secret: clientSecret,
      code: args.code,
      redirect_uri: args.redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await fetch(oauth2Config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OAuth2 Token Exchange] Failed:', errorText);
      throw new Error(
        `Token exchange failed: ${response.status} - ${errorText}`,
      );
    }

    const tokens = await fetchJson<TokenResponse>(response);

    if (!tokens.access_token) {
      console.error(
        `[OAuth2 Token Exchange] Response missing access_token for integration ${args.integrationId}`,
      );
      throw new Error(
        'OAuth2 token exchange returned an invalid response. Please try authorizing again.',
      );
    }

    const accessTokenEncrypted = await encryptString(tokens.access_token);
    const refreshTokenEncrypted = tokens.refresh_token
      ? await encryptString(tokens.refresh_token)
      : undefined;

    const tokenExpiry = tokens.expires_in
      ? Math.floor(Date.now() / 1000) + tokens.expires_in
      : undefined;

    const scopes = tokens.scope ? tokens.scope.split(' ') : undefined;

    await ctx.runMutation(
      internal.integrations.internal_mutations.updateIntegration,
      {
        integrationId: args.integrationId,
        oauth2Auth: {
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenExpiry,
          scopes,
        },
        status: 'active',
        isActive: true,
        errorMessage: undefined,
      },
    );

    debugLog(
      `OAuth2 token exchange successful for integration ${args.integrationId}`,
    );
  },
});

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
    credentialId: v.id('integrationCredentials'),
    code: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const credential = await ctx.runQuery(
      internal.integrations.credential_queries.getByIdInternal,
      { credentialId: args.credentialId },
    );

    if (!credential) {
      throw new Error('Integration credential not found');
    }

    const fileResult = await ctx.runAction(
      internal.integrations.file_actions.readIntegrationForExecution,
      { orgSlug: 'default', slug: credential.slug },
    );

    const fileOAuth2Config = fileResult?.ok
      ? fileResult.config?.oauth2Config
      : undefined;
    const dbOAuth2Config = credential.oauth2Config;

    const tokenUrl = fileOAuth2Config?.tokenUrl ?? dbOAuth2Config?.tokenUrl;
    const clientId = dbOAuth2Config?.clientId;
    const clientSecretEncrypted = dbOAuth2Config?.clientSecretEncrypted;

    if (!clientId || !clientSecretEncrypted || !tokenUrl) {
      throw new Error('Integration OAuth2 client credentials not configured');
    }

    const clientSecret = await ctx.runAction(
      internal.lib.crypto.internal_actions.decryptString,
      { jwe: clientSecretEncrypted },
    );

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: args.code,
      redirect_uri: args.redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await fetch(tokenUrl, {
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
        `[OAuth2 Token Exchange] Response missing access_token for credential ${args.credentialId}`,
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
      internal.integrations.credential_mutations.updateCredentialsInternal,
      {
        credentialId: args.credentialId,
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
      `OAuth2 token exchange successful for credential ${args.credentialId}`,
    );

    return {};
  },
});

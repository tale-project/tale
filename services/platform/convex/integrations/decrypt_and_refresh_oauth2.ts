/**
 * Generic OAuth2 token decrypt and refresh for integrations.
 *
 * Provider-agnostic: uses oauth2Config.tokenUrl with standard grant_type=refresh_token.
 * Returns decrypted accessToken, refreshing first if the token is expired or expiring soon.
 */

import type { Doc } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { internal } from '../_generated/api';
import { encryptString } from '../lib/crypto/encrypt_string';
import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations OAuth2]');

interface TokenRefreshResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
}

export async function decryptAndRefreshIntegrationOAuth2(
  ctx: ActionCtx,
  integration: Doc<'integrations'>,
): Promise<string> {
  const { oauth2Auth, oauth2Config } = integration;

  if (!oauth2Auth?.accessTokenEncrypted) {
    throw new Error(
      'Integration OAuth2 not authorized yet. Please complete the OAuth2 authorization flow.',
    );
  }

  const currentTime = Math.floor(Date.now() / 1000);
  const needsRefresh =
    !oauth2Auth.tokenExpiry || currentTime >= oauth2Auth.tokenExpiry - 300;

  if (
    needsRefresh &&
    oauth2Auth.refreshTokenEncrypted &&
    oauth2Config?.clientId &&
    oauth2Config.clientSecretEncrypted
  ) {
    debugLog(
      `OAuth2 token expired or expiring soon for integration ${integration._id}, refreshing...`,
    );

    const [refreshToken, clientSecret] = await Promise.all([
      ctx.runAction(internal.lib.crypto.internal_actions.decryptString, {
        jwe: oauth2Auth.refreshTokenEncrypted,
      }),
      ctx.runAction(internal.lib.crypto.internal_actions.decryptString, {
        jwe: oauth2Config.clientSecretEncrypted,
      }),
    ]);

    const body = new URLSearchParams({
      client_id: oauth2Config.clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(oauth2Config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[Integration OAuth2] Token refresh failed for ${integration._id}:`,
        errorText,
      );
      throw new Error(
        'Failed to refresh OAuth2 token. Please re-authorize the integration.',
      );
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- OAuth2 token response
    const tokens = (await response.json()) as TokenRefreshResponse;

    const accessTokenEncrypted = await encryptString(tokens.access_token);
    const refreshTokenEncrypted = tokens.refresh_token
      ? await encryptString(tokens.refresh_token)
      : oauth2Auth.refreshTokenEncrypted;

    const tokenExpiry = tokens.expires_in
      ? Math.floor(Date.now() / 1000) + tokens.expires_in
      : undefined;

    await ctx.runMutation(
      internal.integrations.internal_mutations.updateIntegration,
      {
        integrationId: integration._id,
        oauth2Auth: {
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenExpiry,
          scopes: tokens.scope ? tokens.scope.split(' ') : oauth2Auth.scopes,
        },
      },
    );

    debugLog(
      `OAuth2 token refreshed successfully for integration ${integration._id}`,
    );

    return tokens.access_token;
  }

  const accessToken = await ctx.runAction(
    internal.lib.crypto.internal_actions.decryptString,
    { jwe: oauth2Auth.accessTokenEncrypted },
  );

  return accessToken;
}

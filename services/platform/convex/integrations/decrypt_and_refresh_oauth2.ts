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
    oauth2Auth.tokenExpiry != null &&
    currentTime >= oauth2Auth.tokenExpiry - 300;

  if (!needsRefresh) {
    debugLog(
      `OAuth2 token still valid for integration ${integration._id} ` +
        `(expires in ${(oauth2Auth.tokenExpiry ?? 0) - currentTime}s)`,
    );
    return await ctx.runAction(
      internal.lib.crypto.internal_actions.decryptString,
      { jwe: oauth2Auth.accessTokenEncrypted },
    );
  }

  // Token needs refresh — check prerequisites
  const missingPrerequisites: string[] = [];
  if (!oauth2Auth.refreshTokenEncrypted) {
    missingPrerequisites.push('refresh token');
  }
  if (!oauth2Config?.clientId) {
    missingPrerequisites.push('client ID');
  }
  if (!oauth2Config?.clientSecretEncrypted) {
    missingPrerequisites.push('client secret');
  }

  if (
    missingPrerequisites.length > 0 ||
    !oauth2Auth.refreshTokenEncrypted ||
    !oauth2Config?.clientId ||
    !oauth2Config.clientSecretEncrypted
  ) {
    console.error(
      `[Integration OAuth2] Token expired for ${integration._id} but cannot refresh: ` +
        `missing ${missingPrerequisites.join(', ')}`,
    );
    throw new Error(
      `OAuth2 access token has expired but cannot refresh: missing ${missingPrerequisites.join(', ')}. ` +
        'Please re-authorize the integration.',
    );
  }

  const expiresIn = (oauth2Auth.tokenExpiry ?? 0) - currentTime;
  console.log(
    `[Integration OAuth2] Refreshing token for integration ${integration._id} ` +
      `(${expiresIn > 0 ? `expires in ${expiresIn}s` : `expired ${-expiresIn}s ago`})`,
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

  const refreshTime = Math.floor(Date.now() / 1000);

  const response = await fetch(oauth2Config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `[Integration OAuth2] Token refresh failed for ${integration._id} ` +
        `(status ${response.status}):`,
      errorText,
    );
    throw new Error(
      'Failed to refresh OAuth2 token. Please re-authorize the integration.',
    );
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- OAuth2 token response
  const tokens = (await response.json()) as TokenRefreshResponse;

  if (!tokens.access_token) {
    console.error(
      `[Integration OAuth2] Token refresh response missing access_token for ${integration._id}`,
    );
    throw new Error(
      'OAuth2 token refresh returned an invalid response. Please re-authorize the integration.',
    );
  }

  const accessTokenEncrypted = await encryptString(tokens.access_token);
  const refreshTokenEncrypted = tokens.refresh_token
    ? await encryptString(tokens.refresh_token)
    : oauth2Auth.refreshTokenEncrypted;

  const tokenExpiry = tokens.expires_in
    ? refreshTime + tokens.expires_in
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

  console.log(
    `[Integration OAuth2] Token refreshed successfully for integration ${integration._id} ` +
      `(new expiry in ${tokens.expires_in ?? 'unknown'}s)`,
  );

  return tokens.access_token;
}

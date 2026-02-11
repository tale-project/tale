/**
 * Build secrets object from stored integration credentials for test connection.
 * Maps auth method to secrets that the connector's testConnection(ctx) can access.
 */

import type { Doc } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { internal } from '../_generated/api';
import { decryptAndRefreshIntegrationOAuth2 } from './decrypt_and_refresh_oauth2';

export async function buildTestSecrets(
  ctx: ActionCtx,
  integration: Doc<'integrations'>,
): Promise<Record<string, string>> {
  const secrets: Record<string, string> = {};

  if (integration.connectionConfig?.domain) {
    secrets['domain'] = integration.connectionConfig.domain;
  }

  if (integration.authMethod === 'api_key' && integration.apiKeyAuth) {
    const decrypted = await ctx.runAction(
      internal.lib.crypto.internal_actions.decryptString,
      { jwe: integration.apiKeyAuth.keyEncrypted },
    );
    secrets['accessToken'] = decrypted;
  }

  if (integration.authMethod === 'basic_auth' && integration.basicAuth) {
    secrets['username'] = integration.basicAuth.username;
    const decrypted = await ctx.runAction(
      internal.lib.crypto.internal_actions.decryptString,
      { jwe: integration.basicAuth.passwordEncrypted },
    );
    secrets['password'] = decrypted;
  }

  if (integration.authMethod === 'oauth2' && integration.oauth2Auth) {
    secrets['accessToken'] = await decryptAndRefreshIntegrationOAuth2(
      ctx,
      integration,
    );
  }

  return secrets;
}

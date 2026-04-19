/**
 * Build secrets object from stored integration credentials.
 * Maps auth method to decrypted credential values (accessToken, password, etc.).
 */

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { decryptAndRefreshIntegrationOAuth2 } from './decrypt_and_refresh_oauth2';
import type { IntegrationWithCredentials } from './shared_types';

export async function buildIntegrationSecrets(
  ctx: ActionCtx,
  integration: IntegrationWithCredentials,
  credentialId?: Id<'integrationCredentials'>,
): Promise<Record<string, string>> {
  const secrets: Record<string, string> = {};

  // Pass all string connectionConfig values as secrets (domain, model, apiEndpoint, etc.)
  if (integration.connectionConfig) {
    for (const [key, value] of Object.entries(integration.connectionConfig)) {
      if (typeof value === 'string' && value) {
        secrets[key] = value;
      }
    }
  }

  const declaredBindings = integration.secretBindings ?? [];
  const apiKeyBinding = declaredBindings[0] ?? 'accessToken';
  const oauth2Binding = declaredBindings.includes('accessToken')
    ? 'accessToken'
    : (declaredBindings[0] ?? 'accessToken');

  if (
    (integration.authMethod === 'api_key' ||
      integration.authMethod === 'bearer_token') &&
    integration.apiKeyAuth
  ) {
    const decrypted = await ctx.runAction(
      internal.lib.crypto.internal_actions.decryptString,
      { jwe: integration.apiKeyAuth.keyEncrypted },
    );
    secrets[apiKeyBinding] = decrypted;
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
    secrets[oauth2Binding] = await decryptAndRefreshIntegrationOAuth2(
      ctx,
      integration,
      credentialId,
    );
  }

  return secrets;
}

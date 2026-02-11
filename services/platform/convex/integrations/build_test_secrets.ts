/**
 * Build secrets object from stored integration credentials for test connection.
 * Maps auth method to secrets that the connector's testConnection(ctx) can access.
 */

import type { Doc } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { internal } from '../_generated/api';

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

  return secrets;
}

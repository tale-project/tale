/**
 * Build secrets object from integration credentials
 * Maps secretBindings to actual decrypted values
 */

import type { Doc } from '../../../../_generated/dataModel';
import type { ActionDefinition } from '../../../helpers/nodes/action/types';

import { internal } from '../../../../_generated/api';

export async function buildSecretsFromIntegration(
  ctx: Parameters<ActionDefinition['execute']>[0],
  integration: Doc<'integrations'>,
): Promise<Record<string, string>> {
  const secrets: Record<string, string> = {};

  // Add domain from connectionConfig
  if (integration.connectionConfig?.domain) {
    secrets['domain'] = integration.connectionConfig.domain;
  }

  // Decrypt and add credentials based on auth method
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

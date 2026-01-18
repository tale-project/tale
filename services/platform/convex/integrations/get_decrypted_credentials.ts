/**
 * Business logic for getting decrypted credentials
 */

import { ActionCtx } from '../_generated/server';
import { Id } from '../_generated/dataModel';
import { api, internal } from '../_generated/api';
import { DecryptedCredentials } from './types';

export interface GetDecryptedCredentialsArgs {
  integrationId: Id<'integrations'>;
}

/**
 * Main logic for getting decrypted credentials
 */
export async function getDecryptedCredentialsLogic(
  ctx: ActionCtx,
  args: GetDecryptedCredentialsArgs,
): Promise<DecryptedCredentials> {
  const integration = await ctx.runQuery(api.integrations.queries.get.get, {
    integrationId: args.integrationId,
  });

  if (!integration) {
    throw new Error('Integration not found');
  }

  const credentials: DecryptedCredentials = {
    name: integration.name,
    connectionConfig: integration.connectionConfig,
  };

  if (integration.apiKeyAuth) {
    const key = await ctx.runAction(internal.lib.crypto.actions.decryptStringInternal, {
      jwe: integration.apiKeyAuth.keyEncrypted,
    });
    credentials.apiKey = key;
    credentials.keyPrefix = integration.apiKeyAuth.keyPrefix;
  }

  if (integration.basicAuth) {
    const password = await ctx.runAction(
      internal.lib.crypto.actions.decryptStringInternal,
      {
        jwe: integration.basicAuth.passwordEncrypted,
      },
    );
    credentials.username = integration.basicAuth.username;
    credentials.password = password;
  }

  if (integration.oauth2Auth) {
    const accessToken = await ctx.runAction(
      internal.lib.crypto.actions.decryptStringInternal,
      {
        jwe: integration.oauth2Auth.accessTokenEncrypted,
      },
    );
    credentials.accessToken = accessToken;

    if (integration.oauth2Auth.refreshTokenEncrypted) {
      const refreshToken = await ctx.runAction(
        internal.lib.crypto.actions.decryptStringInternal,
        {
          jwe: integration.oauth2Auth.refreshTokenEncrypted,
        },
      );
      credentials.refreshToken = refreshToken;
    }

    credentials.tokenExpiry = integration.oauth2Auth.tokenExpiry;
    credentials.scopes = integration.oauth2Auth.scopes;
  }

  return credentials;
}

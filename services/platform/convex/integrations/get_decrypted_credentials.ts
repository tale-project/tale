/**
 * Decrypt and return integration credentials
 */

import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import type { DecryptedCredentials } from './types';

import { internal } from '../_generated/api';

export interface GetDecryptedCredentialsArgs {
  credentialId: Id<'integrationCredentials'>;
}

/**
 * Retrieve and decrypt an integration's stored credentials
 */
export async function getDecryptedCredentials(
  ctx: ActionCtx,
  args: GetDecryptedCredentialsArgs,
): Promise<DecryptedCredentials> {
  const integration = await ctx.runQuery(
    internal.integrations.credential_queries.getByIdInternal,
    { credentialId: args.credentialId },
  );

  if (!integration) {
    throw new Error('Integration not found');
  }

  const credentials: DecryptedCredentials = {
    name: integration.slug,
    connectionConfig: integration.connectionConfig,
  };

  if (integration.apiKeyAuth) {
    const key = await ctx.runAction(
      internal.lib.crypto.internal_actions.decryptString,
      {
        jwe: integration.apiKeyAuth.keyEncrypted,
      },
    );
    credentials.apiKey = key;
    credentials.keyPrefix = integration.apiKeyAuth.keyPrefix;
  }

  if (integration.basicAuth) {
    const password = await ctx.runAction(
      internal.lib.crypto.internal_actions.decryptString,
      {
        jwe: integration.basicAuth.passwordEncrypted,
      },
    );
    credentials.username = integration.basicAuth.username;
    credentials.password = password;
  }

  if (integration.oauth2Auth) {
    const accessToken = await ctx.runAction(
      internal.lib.crypto.internal_actions.decryptString,
      {
        jwe: integration.oauth2Auth.accessTokenEncrypted,
      },
    );
    credentials.accessToken = accessToken;

    if (integration.oauth2Auth.refreshTokenEncrypted) {
      const refreshToken = await ctx.runAction(
        internal.lib.crypto.internal_actions.decryptString,
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

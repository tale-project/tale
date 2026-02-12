/**
 * Save OAuth2 client credentials (clientId + clientSecret) to an integration's oauth2Config.
 *
 * Encrypts the clientSecret before storing. Also persists any user-edited
 * authorizationUrl / tokenUrl / scopes overrides.
 */

import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { api, internal } from '../_generated/api';
import { encryptString } from '../lib/crypto/encrypt_string';

interface SaveOAuth2ClientCredentialsArgs {
  integrationId: Id<'integrations'>;
  authorizationUrl: string;
  tokenUrl: string;
  scopes?: string[];
  clientId: string;
  clientSecret: string;
}

export async function saveOAuth2ClientCredentials(
  ctx: ActionCtx,
  args: SaveOAuth2ClientCredentialsArgs,
): Promise<void> {
  const integration = await ctx.runQuery(api.integrations.queries.get, {
    integrationId: args.integrationId,
  });

  if (!integration) {
    throw new Error('Integration not found');
  }

  const clientSecretEncrypted = await encryptString(args.clientSecret);

  await ctx.runMutation(
    internal.integrations.internal_mutations.updateIntegration,
    {
      integrationId: args.integrationId,
      oauth2Config: {
        authorizationUrl: args.authorizationUrl,
        tokenUrl: args.tokenUrl,
        scopes: args.scopes,
        clientId: args.clientId,
        clientSecretEncrypted,
      },
    },
  );
}

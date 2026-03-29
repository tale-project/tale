/**
 * Save OAuth2 client credentials (clientId + clientSecret) to the integrationCredentials table.
 *
 * Encrypts the clientSecret before storing. Also persists any user-edited
 * authorizationUrl / tokenUrl / scopes overrides.
 */

import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { internal } from '../_generated/api';
import { encryptString } from '../lib/crypto/encrypt_string';

interface SaveOAuth2ClientCredentialsArgs {
  credentialId: Id<'integrationCredentials'>;
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
  const credential = await ctx.runQuery(
    internal.integrations.credential_queries.getByIdInternal,
    { credentialId: args.credentialId },
  );

  if (!credential) {
    throw new Error('Integration credential not found');
  }

  const clientSecretEncrypted = await encryptString(args.clientSecret);

  await ctx.runMutation(
    internal.integrations.credential_mutations.updateCredentialsInternal,
    {
      credentialId: args.credentialId,
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

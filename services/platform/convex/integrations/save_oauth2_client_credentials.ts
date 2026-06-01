/**
 * Save OAuth2 client credentials (clientId + clientSecret) to the integrationCredentials table.
 *
 * Encrypts the clientSecret before storing. Also persists any user-edited
 * authorizationUrl / tokenUrl / scopes overrides.
 *
 * `signingSecret` is Slack-only (the app's request-signing secret). When it is
 * provided it is encrypted and stored; when omitted, any previously stored
 * `signingSecretEncrypted` is carried forward so re-saving the client
 * id/secret with the signing-secret field left blank does not wipe it
 * (mirrors the "leave the client secret blank to keep it" UX).
 */

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { encryptString } from '../lib/crypto/encrypt_string';

interface SaveOAuth2ClientCredentialsArgs {
  credentialId: Id<'integrationCredentials'>;
  authorizationUrl: string;
  tokenUrl: string;
  scopes?: string[];
  clientId: string;
  clientSecret: string;
  signingSecret?: string;
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

  const signingSecretEncrypted = args.signingSecret
    ? await encryptString(args.signingSecret)
    : credential.oauth2Config?.signingSecretEncrypted;

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
        signingSecretEncrypted,
      },
    },
  );
}

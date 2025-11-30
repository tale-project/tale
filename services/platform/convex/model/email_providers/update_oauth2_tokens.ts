/**
 * Update OAuth2 tokens for an email provider
 */

import type { MutationCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';

export interface UpdateOAuth2TokensArgs {
  emailProviderId: Doc<'emailProviders'>['_id'];
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  tokenExpiry?: number;
  tokenType: string;
  scope?: string;
}

export async function updateOAuth2Tokens(
  ctx: MutationCtx,
  args: UpdateOAuth2TokensArgs,
): Promise<null> {
  const provider = await ctx.db.get(args.emailProviderId);
  if (!provider) {
    throw new Error('Email provider not found');
  }

  if (!provider.oauth2Auth) {
    throw new Error('Provider is not configured for OAuth2');
  }

  // Derive tenant-specific tokenUrl for Microsoft if missing
  let tokenUrl: string | undefined = provider.oauth2Auth.tokenUrl as
    | string
    | undefined;
  if (
    provider.oauth2Auth.provider === 'microsoft' &&
    (!tokenUrl || tokenUrl.length === 0)
  ) {
    const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
    if (issuer) {
      const match = issuer.match(/\/([^\/]+)\/v2\.0$/);
      if (match) {
        const tenantId = match[1];
        tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
        console.log(
          `[EmailProviders] Derived tenant tokenUrl for Microsoft provider ${provider._id}: ${tokenUrl}`,
        );
      }
    }
  }

  // Update OAuth2 auth with new tokens (and tokenUrl if newly derived)
  const updatedOAuth2Auth = {
    ...provider.oauth2Auth,
    accessTokenEncrypted: args.accessTokenEncrypted,
    refreshTokenEncrypted: args.refreshTokenEncrypted,
    tokenExpiry: args.tokenExpiry,
    ...(tokenUrl ? { tokenUrl } : {}),
  } as any;

  await ctx.db.patch(args.emailProviderId, {
    oauth2Auth: updatedOAuth2Auth,
  });

  return null;
}

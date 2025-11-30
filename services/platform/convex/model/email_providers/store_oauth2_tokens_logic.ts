/**
 * Business logic for storing OAuth2 tokens
 */

import type { ActionCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';

export interface StoreOAuth2TokensArgs {
  emailProviderId: Doc<'emailProviders'>['_id'];
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
  scope?: string;
}

export interface StoreOAuth2TokensDependencies {
  encryptString: (plaintext: string) => Promise<string>;
  updateTokens: (params: {
    emailProviderId: Doc<'emailProviders'>['_id'];
    accessTokenEncrypted: string;
    refreshTokenEncrypted?: string;
    tokenExpiry?: number;
    tokenType: string;
    scope?: string;
  }) => Promise<void>;
}

/**
 * Main logic for storing OAuth2 tokens
 * Handles encryption and expiry calculation
 */
export async function storeOAuth2TokensLogic(
  ctx: ActionCtx,
  args: StoreOAuth2TokensArgs,
  deps: StoreOAuth2TokensDependencies,
): Promise<null> {
  // Encrypt tokens
  const accessTokenEncrypted = await deps.encryptString(args.accessToken);

  const refreshTokenEncrypted = args.refreshToken
    ? await deps.encryptString(args.refreshToken)
    : undefined;

  // Calculate expiry timestamp
  const tokenExpiry = args.expiresIn
    ? Math.floor(Date.now() / 1000) + args.expiresIn
    : undefined;

  // Update provider with encrypted tokens
  await deps.updateTokens({
    emailProviderId: args.emailProviderId,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    tokenExpiry,
    tokenType: args.tokenType,
    scope: args.scope,
  });

  return null;
}


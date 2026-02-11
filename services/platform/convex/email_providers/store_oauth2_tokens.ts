import type { Doc } from '../_generated/dataModel';

interface StoreOAuth2TokensArgs {
  emailProviderId: Doc<'emailProviders'>['_id'];
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
  scope?: string;
}

interface StoreOAuth2TokensDependencies {
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

export async function storeOAuth2Tokens(
  args: StoreOAuth2TokensArgs,
  deps: StoreOAuth2TokensDependencies,
): Promise<null> {
  const accessTokenEncrypted = await deps.encryptString(args.accessToken);

  const refreshTokenEncrypted = args.refreshToken
    ? await deps.encryptString(args.refreshToken)
    : undefined;

  const tokenExpiry = args.expiresIn
    ? Math.floor(Date.now() / 1000) + args.expiresIn
    : undefined;

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

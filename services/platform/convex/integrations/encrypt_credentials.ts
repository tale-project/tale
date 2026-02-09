/**
 * Helper to encrypt credentials for integrations.
 */

import type {
  ApiKeyAuth,
  BasicAuth,
  OAuth2Auth,
  ApiKeyAuthEncrypted,
  BasicAuthEncrypted,
  OAuth2AuthEncrypted,
} from './types';

import { encryptString } from '../lib/crypto/encrypt_string';

export interface EncryptableCredentials {
  apiKeyAuth?: ApiKeyAuth;
  basicAuth?: BasicAuth;
  oauth2Auth?: OAuth2Auth;
}

export async function encryptCredentials(
  args: EncryptableCredentials,
): Promise<{
  apiKeyAuth?: ApiKeyAuthEncrypted;
  basicAuth?: BasicAuthEncrypted;
  oauth2Auth?: OAuth2AuthEncrypted;
}> {
  let apiKeyAuth = undefined;
  let basicAuth = undefined;
  let oauth2Auth = undefined;

  if (args.apiKeyAuth) {
    const keyEncrypted = await encryptString(args.apiKeyAuth.key);
    apiKeyAuth = {
      keyEncrypted,
      keyPrefix: args.apiKeyAuth.keyPrefix,
    };
  }

  if (args.basicAuth) {
    const passwordEncrypted = await encryptString(args.basicAuth.password);
    basicAuth = {
      username: args.basicAuth.username,
      passwordEncrypted,
    };
  }

  if (args.oauth2Auth) {
    const accessTokenEncrypted = await encryptString(
      args.oauth2Auth.accessToken,
    );
    const refreshTokenEncrypted = args.oauth2Auth.refreshToken
      ? await encryptString(args.oauth2Auth.refreshToken)
      : undefined;

    oauth2Auth = {
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiry: args.oauth2Auth.tokenExpiry,
      scopes: args.oauth2Auth.scopes,
    };
  }

  return { apiKeyAuth, basicAuth, oauth2Auth };
}

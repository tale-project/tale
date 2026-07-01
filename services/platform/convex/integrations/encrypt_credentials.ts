/**
 * Helper to encrypt credentials for integrations.
 */

import { encryptString } from '../lib/crypto/encrypt_string';
import type {
  ApiKeyAuth,
  BasicAuth,
  OAuth2Auth,
  SmtpAuth,
  ApiKeyAuthEncrypted,
  BasicAuthEncrypted,
  OAuth2AuthEncrypted,
  SmtpAuthEncrypted,
} from './types';

export interface EncryptableCredentials {
  apiKeyAuth?: ApiKeyAuth;
  basicAuth?: BasicAuth;
  oauth2Auth?: OAuth2Auth;
  smtpAuth?: SmtpAuth;
}

export async function encryptCredentials(
  args: EncryptableCredentials,
): Promise<{
  apiKeyAuth?: ApiKeyAuthEncrypted;
  basicAuth?: BasicAuthEncrypted;
  oauth2Auth?: OAuth2AuthEncrypted;
  smtpAuth?: SmtpAuthEncrypted;
}> {
  let apiKeyAuth = undefined;
  let basicAuth = undefined;
  let oauth2Auth = undefined;
  let smtpAuth = undefined;

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

  if (args.smtpAuth) {
    const passwordEncrypted = await encryptString(args.smtpAuth.password);
    smtpAuth = {
      username: args.smtpAuth.username,
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

  return { apiKeyAuth, basicAuth, oauth2Auth, smtpAuth };
}

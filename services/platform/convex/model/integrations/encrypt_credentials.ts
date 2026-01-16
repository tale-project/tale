/**
 * Helper to encrypt credentials for integrations.
 */

import { ActionCtx } from '../../_generated/server';
import { internal } from '../../_generated/api';
import {
  ApiKeyAuthEncrypted,
  BasicAuthEncrypted,
  OAuth2AuthEncrypted,
} from './types';
import type { CreateIntegrationLogicArgs } from './create_integration_logic';

export async function encryptCredentials(
  ctx: ActionCtx,
  args: CreateIntegrationLogicArgs,
): Promise<{
  apiKeyAuth?: ApiKeyAuthEncrypted;
  basicAuth?: BasicAuthEncrypted;
  oauth2Auth?: OAuth2AuthEncrypted;
}> {
  let apiKeyAuth = undefined;
  let basicAuth = undefined;
  let oauth2Auth = undefined;

  if (args.apiKeyAuth) {
    const keyEncrypted = await ctx.runAction(internal.actions.oauth2.encryptStringInternal, {
      plaintext: args.apiKeyAuth.key,
    });
    apiKeyAuth = {
      keyEncrypted,
      keyPrefix: args.apiKeyAuth.keyPrefix,
    };
  }

  if (args.basicAuth) {
    const passwordEncrypted = await ctx.runAction(
      internal.actions.oauth2.encryptStringInternal,
      {
        plaintext: args.basicAuth.password,
      },
    );
    basicAuth = {
      username: args.basicAuth.username,
      passwordEncrypted,
    };
  }

  if (args.oauth2Auth) {
    const accessTokenEncrypted = await ctx.runAction(
      internal.actions.oauth2.encryptStringInternal,
      {
        plaintext: args.oauth2Auth.accessToken,
      },
    );
    const refreshTokenEncrypted = args.oauth2Auth.refreshToken
      ? await ctx.runAction(internal.actions.oauth2.encryptStringInternal, {
          plaintext: args.oauth2Auth.refreshToken,
        })
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


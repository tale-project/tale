'use node';

/**
 * Node write surface for cloud-import authorizations — plaintext tokens exist
 * only here, then cross into V8 mutations as ciphertext.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import {
  parseSecretPayload,
  SecretPayloadError,
} from '../connector_credentials/auth_injection';
import { encryptSecret } from '../lib/secret_box';
import { cloudImportProviderValidator } from './schema';

export const storeAuthorization = internalAction({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    provider: cloudImportProviderValidator,
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    scopes: v.array(v.string()),
    accountLabel: v.optional(v.string()),
  },
  returns: v.object({ authorizationId: v.string() }),
  handler: async (ctx, args) => {
    let payload;
    try {
      payload = parseSecretPayload('oauth2', {
        accessToken: args.accessToken,
        ...(args.refreshToken !== undefined && {
          refreshToken: args.refreshToken,
        }),
        ...(args.expiresAt !== undefined && { expiresAt: args.expiresAt }),
        scopes: args.scopes,
      });
    } catch (err) {
      if (err instanceof SecretPayloadError) {
        throw new Error(err.message);
      }
      throw err;
    }
    const { authMethod: _method, ...document } = payload;
    const encryptedData = encryptSecret(JSON.stringify(document));
    const authorizationId = await ctx.runMutation(
      internal.cloud_import.mutations.upsertAuthorizationInternal,
      {
        organizationId: args.organizationId,
        userId: args.userId,
        provider: args.provider,
        encryptedData,
        scopes: args.scopes,
        ...(args.accountLabel !== undefined && {
          accountLabel: args.accountLabel,
        }),
      },
    );
    return { authorizationId: authorizationId as string };
  },
});

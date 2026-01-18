/**
 * Internal mutation to update OAuth2 tokens
 */

import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';

export const updateOAuth2Tokens = internalMutation({
  args: {
    emailProviderId: v.id('emailProviders'),
    accessTokenEncrypted: v.string(),
    refreshTokenEncrypted: v.optional(v.string()),
    tokenExpiry: v.optional(v.number()),
    tokenType: v.string(),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const provider = await ctx.db.get(args.emailProviderId);
    if (!provider || !provider.oauth2Auth) {
      throw new Error('Email provider not found or not configured for OAuth2');
    }

    await ctx.db.patch(args.emailProviderId, {
      oauth2Auth: {
        ...provider.oauth2Auth,
        accessTokenEncrypted: args.accessTokenEncrypted,
        refreshTokenEncrypted: args.refreshTokenEncrypted ?? provider.oauth2Auth.refreshTokenEncrypted,
        tokenExpiry: args.tokenExpiry,
      },
    });

    return null;
  },
});

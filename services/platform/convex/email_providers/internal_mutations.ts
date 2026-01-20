/**
 * Email Providers Internal Mutations
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import {
  emailProviderVendorValidator,
  emailProviderAuthMethodValidator,
  emailProviderStatusValidator,
  sendMethodValidator,
  smtpConfigValidator,
  imapConfigValidator,
  passwordAuthEncryptedValidator,
  oauth2AuthStoredValidator,
} from './validators';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { createProviderInternal } from './create_provider_internal';

export const createProvider = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    vendor: emailProviderVendorValidator,
    authMethod: emailProviderAuthMethodValidator,
    sendMethod: v.optional(sendMethodValidator),
    passwordAuth: v.optional(passwordAuthEncryptedValidator),
    oauth2Auth: v.optional(oauth2AuthStoredValidator),
    smtpConfig: v.optional(smtpConfigValidator),
    imapConfig: v.optional(imapConfigValidator),
    isDefault: v.boolean(),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    return await createProviderInternal(ctx, args);
  },
});

export const updateMetadata = internalMutation({
  args: {
    providerId: v.id('emailProviders'),
    metadata: v.object({
      redirectUri: v.optional(v.string()),
      redirectOrigin: v.optional(v.string()),
      redirectUpdatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const provider = await ctx.db.get(args.providerId);
    if (!provider) {
      throw new Error('Email provider not found');
    }

    const updatedMetadata = {
      ...(provider.metadata || {}),
      ...args.metadata,
    };

    await ctx.db.patch(args.providerId, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: updatedMetadata as any,
    });

    return null;
  },
});

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

export const updateProviderStatus = internalMutation({
  args: {
    providerId: v.id('emailProviders'),
    status: v.optional(emailProviderStatusValidator),
    lastTestedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { providerId, ...patch } = args;
    await ctx.db.patch(providerId, patch);
    return null;
  },
});

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
import { updateProvider as updateProviderHelper } from './update_provider';

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
    metadata: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
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
    tokenUrl: v.optional(v.string()),
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
        tokenUrl: args.tokenUrl ?? provider.oauth2Auth.tokenUrl,
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

export const updateProvider = internalMutation({
  args: {
    providerId: v.id('emailProviders'),
    name: v.optional(v.string()),
    sendMethod: v.optional(sendMethodValidator),
    oauth2Auth: v.optional(oauth2AuthStoredValidator),
    smtpConfig: v.optional(smtpConfigValidator),
    status: v.optional(emailProviderStatusValidator),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    return await updateProviderHelper(ctx, args);
  },
});

'use node';

import { v } from 'convex/values';

import type { EmailProviderVendor } from '../../lib/shared/schemas/email_providers';
import type { Id } from '../_generated/dataModel';
import type { TestResult } from './test_existing_provider';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { decryptString } from '../lib/crypto/decrypt_string';
import { encryptString } from '../lib/crypto/encrypt_string';
import { createOAuth2ProviderLogic } from './create_oauth2_provider_logic';
import { createProviderLogic } from './create_provider_logic';
import { generateOAuth2AuthUrlLogic } from './generate_oauth2_auth_url_logic';
import { storeOAuth2TokensLogic } from './store_oauth2_tokens_logic';
import { testExistingProviderLogic } from './test_existing_provider_logic';
import { updateOAuth2ProviderLogic } from './update_oauth2_provider_logic';
import {
  emailProviderVendorValidator,
  emailProviderAuthMethodValidator,
  sendMethodValidator,
  smtpConfigValidator,
  imapConfigValidator,
  passwordAuthValidator,
} from './validators';

export const create = action({
  args: {
    organizationId: v.string(),
    name: v.string(),
    vendor: emailProviderVendorValidator,
    authMethod: emailProviderAuthMethodValidator,
    sendMethod: v.optional(sendMethodValidator),
    passwordAuth: v.optional(passwordAuthValidator),
    oauth2Auth: v.optional(
      v.object({
        provider: v.string(),
        clientId: v.string(),
        clientSecret: v.string(),
        tokenUrl: v.optional(v.string()),
      }),
    ),
    smtpConfig: v.optional(smtpConfigValidator),
    imapConfig: v.optional(imapConfigValidator),
    isDefault: v.boolean(),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args): Promise<Id<'emailProviders'>> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await createProviderLogic(ctx, args, {
      encryptString,
      createInternal: async (params): Promise<Id<'emailProviders'>> => {
        return await ctx.runMutation(
          internal.email_providers.internal_mutations.createProvider,
          params,
        );
      },
    });
  },
});

export const createOAuth2Provider = action({
  args: {
    organizationId: v.string(),
    name: v.string(),
    vendor: v.union(v.literal('gmail'), v.literal('outlook')),
    provider: v.union(v.literal('gmail'), v.literal('microsoft')),
    sendMethod: v.optional(sendMethodValidator),
    smtpConfig: v.optional(smtpConfigValidator),
    imapConfig: v.optional(imapConfigValidator),
    isDefault: v.boolean(),
    accountType: v.optional(
      v.union(
        v.literal('personal'),
        v.literal('organizational'),
        v.literal('both'),
      ),
    ),
    tenantId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    clientSecret: v.optional(v.string()),
    credentialsSource: v.optional(
      v.union(v.literal('sso'), v.literal('manual')),
    ),
  },
  handler: async (ctx, args): Promise<Id<'emailProviders'>> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await createOAuth2ProviderLogic(ctx, args, {
      encryptString,
      createInternal: async (params): Promise<Id<'emailProviders'>> => {
        return await ctx.runMutation(
          internal.email_providers.internal_mutations.createProvider,
          params,
        );
      },
    });
  },
});

export const generateOAuth2AuthUrl = action({
  args: {
    emailProviderId: v.id('emailProviders'),
    organizationId: v.string(),
    redirectUri: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const authUrl = await generateOAuth2AuthUrlLogic(ctx, args, {
      getProvider: async (providerId) => {
        return await ctx.runQuery(
          internal.email_providers.internal_queries.get,
          { providerId },
        );
      },
      setMetadata: async (providerId, config) => {
        await ctx.runMutation(
          internal.email_providers.internal_mutations.updateMetadata,
          { providerId, metadata: config },
        );
      },
    });
    return { authUrl };
  },
});

export const storeOAuth2Tokens = action({
  args: {
    emailProviderId: v.id('emailProviders'),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    tokenType: v.string(),
    expiresIn: v.optional(v.number()),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await storeOAuth2TokensLogic(args, {
      encryptString,
      updateTokens: async (params) => {
        await ctx.runMutation(
          internal.email_providers.internal_mutations.updateOAuth2Tokens,
          params,
        );
      },
    });
  },
});

export const testConnection = action({
  args: {
    vendor: emailProviderVendorValidator,
    authMethod: emailProviderAuthMethodValidator,
    passwordAuth: v.optional(
      v.object({
        user: v.string(),
        pass: v.string(),
      }),
    ),
    oauth2Auth: v.optional(
      v.object({
        user: v.string(),
        accessToken: v.string(),
      }),
    ),
    smtpConfig: smtpConfigValidator,
    imapConfig: imapConfigValidator,
  },
  handler: async (ctx, args): Promise<TestResult> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await ctx.runAction(
      internal.email_providers.internal_actions.testNewProviderConnection,
      args,
    );
  },
});

export const testExistingProvider = action({
  args: {
    providerId: v.id('emailProviders'),
  },
  handler: async (ctx, args): Promise<TestResult> => {
    return await testExistingProviderLogic(ctx, args.providerId, {
      getProvider: async (providerId) => {
        return await ctx.runQuery(
          internal.email_providers.internal_queries.get,
          { providerId },
        );
      },
      updateStatus: async (providerId, status, lastTestedAt, errorMessage) => {
        await ctx.runMutation(
          internal.email_providers.internal_mutations.updateProviderStatus,
          { providerId, status, lastTestedAt, errorMessage },
        );
      },
      testConnection: async (params) => {
        return await ctx.runAction(
          internal.email_providers.internal_actions.testNewProviderConnection,
          {
            ...params,
            vendor: params.vendor as EmailProviderVendor,
          },
        );
      },
      decryptString,
      refreshToken: async (params) => {
        return await ctx.runAction(internal.oauth2.refreshToken, params);
      },
      storeTokens: async (params) => {
        return await ctx.runAction(
          internal.email_providers.internal_actions.storeOAuth2Tokens,
          params,
        );
      },
      setMetadata: async (providerId, metadata) => {
        await ctx.runMutation(
          internal.email_providers.internal_mutations.updateMetadata,
          { providerId, metadata },
        );
      },
    });
  },
});

export const updateOAuth2Provider = action({
  args: {
    providerId: v.id('emailProviders'),
    name: v.optional(v.string()),
    clientId: v.optional(v.string()),
    clientSecret: v.optional(v.string()),
    tenantId: v.optional(v.string()),
    sendMethod: v.optional(sendMethodValidator),
    credentialsSource: v.optional(
      v.union(v.literal('sso'), v.literal('manual')),
    ),
  },
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await updateOAuth2ProviderLogic(args, {
      encryptString,
      getProvider: async (providerId) => {
        return await ctx.runQuery(
          internal.email_providers.internal_queries.get,
          { providerId },
        );
      },
      updateInternal: async (params) => {
        return await ctx.runMutation(
          internal.email_providers.internal_mutations.updateProvider,
          params,
        );
      },
    });
  },
});

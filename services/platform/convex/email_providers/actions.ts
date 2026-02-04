'use node';

/**
 * Email Providers Public Actions
 */

import { v } from 'convex/values';
import { action } from '../_generated/server';
import { internal, api } from '../_generated/api';
import { authComponent } from '../auth';
import { createProviderLogic } from './create_provider_logic';
import { createOAuth2ProviderLogic } from './create_oauth2_provider_logic';
import { updateOAuth2ProviderLogic } from './update_oauth2_provider_logic';
import { generateOAuth2AuthUrlLogic } from './generate_oauth2_auth_url_logic';
import { storeOAuth2TokensLogic } from './store_oauth2_tokens_logic';
import { testExistingProviderLogic } from './test_existing_provider_logic';
import {
  emailProviderVendorValidator,
  emailProviderAuthMethodValidator,
  sendMethodValidator,
  smtpConfigValidator,
  imapConfigValidator,
  passwordAuthValidator,
} from './validators';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import type { Id, Doc } from '../_generated/dataModel';
import type { TestResult } from './test_existing_provider';
import type { EmailProviderVendor } from '../../lib/shared/schemas/email_providers';

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
      throw new Error('Not authenticated');
    }

    return await createProviderLogic(ctx, args, {
      encryptString: async (plaintext: string): Promise<string> => {
        return await ctx.runAction(internal.lib.crypto.actions.encryptStringInternal, { plaintext });
      },
      createInternal: async (params): Promise<Id<'emailProviders'>> => {
        return await ctx.runMutation(
          internal.email_providers.internal_mutations.createProvider,
          {
            organizationId: params.organizationId,
            name: params.name,
            vendor: params.vendor as 'gmail' | 'outlook' | 'smtp' | 'resend' | 'other',
            authMethod: params.authMethod as 'password' | 'oauth2',
            sendMethod: params.sendMethod,
            passwordAuth: params.passwordAuth,
            oauth2Auth: params.oauth2Auth,
            smtpConfig: params.smtpConfig,
            imapConfig: params.imapConfig,
            isDefault: params.isDefault,
             
            metadata: params.metadata as any,
          },
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
  },
  handler: async (ctx, args): Promise<Id<'emailProviders'>> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    return await createOAuth2ProviderLogic(ctx, args, {
      encryptString: async (plaintext: string): Promise<string> => {
        return await ctx.runAction(internal.lib.crypto.actions.encryptStringInternal, { plaintext });
      },
      createInternal: async (params): Promise<Id<'emailProviders'>> => {
        return await ctx.runMutation(
          internal.email_providers.internal_mutations.createProvider,
          {
            organizationId: params.organizationId,
            name: params.name,
            vendor: params.vendor as 'gmail' | 'outlook' | 'smtp' | 'resend' | 'other',
            authMethod: params.authMethod as 'password' | 'oauth2',
            sendMethod: params.sendMethod,
            oauth2Auth: params.oauth2Auth,
            smtpConfig: params.smtpConfig,
            imapConfig: params.imapConfig,
            isDefault: params.isDefault,
             
            metadata: params.metadata as any,
          },
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
  handler: async (ctx, args): Promise<{ authUrl: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    const authUrl = await generateOAuth2AuthUrlLogic(ctx, args, {
      getProvider: async (providerId: Id<'emailProviders'>): Promise<Doc<'emailProviders'> | null> => {
        return await ctx.runQuery(
          internal.email_providers.internal_queries.getProviderById,
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
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    return await storeOAuth2TokensLogic(ctx, args, {
      encryptString: async (plaintext: string): Promise<string> => {
        return await ctx.runAction(internal.lib.crypto.actions.encryptStringInternal, { plaintext });
      },
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
      throw new Error('Not authenticated');
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
          internal.email_providers.internal_queries.getProviderById,
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
      decryptString: async (encrypted) => {
        return await ctx.runAction(internal.lib.crypto.actions.decryptStringInternal, { jwe: encrypted });
      },
      refreshToken: async (params) => {
        return await ctx.runAction(api.oauth2.refreshToken, params);
      },
      storeTokens: async (params) => {
        return await ctx.runAction(
          api.email_providers.actions.storeOAuth2Tokens,
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
  },
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    return await updateOAuth2ProviderLogic(ctx, args, {
      encryptString: async (plaintext: string): Promise<string> => {
        return await ctx.runAction(internal.lib.crypto.actions.encryptStringInternal, { plaintext });
      },
      getProvider: async (providerId: Id<'emailProviders'>): Promise<Doc<'emailProviders'> | null> => {
        return await ctx.runQuery(
          internal.email_providers.internal_queries.getProviderById,
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

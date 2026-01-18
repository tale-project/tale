'use node';

/**
 * Create Email Provider Public Action
 */

import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { authComponent } from '../../auth';
import { createProviderLogic } from '../create_provider_logic';
import { createOAuth2ProviderLogic } from '../create_oauth2_provider_logic';
import {
  emailProviderVendorValidator,
  emailProviderAuthMethodValidator,
  sendMethodValidator,
  smtpConfigValidator,
  imapConfigValidator,
  passwordAuthValidator,
} from '../validators';
import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';
import type { Id } from '../../_generated/dataModel';

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
          internal.email_providers.internal_mutations.create_provider.createProvider,
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          internal.email_providers.internal_mutations.create_provider.createProvider,
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            metadata: params.metadata as any,
          },
        );
      },
    });
  },
});

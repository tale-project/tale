'use node';

/**
 * Test Existing Provider Public Action
 */

import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal, api } from '../../_generated/api';
import type { TestResult } from '../test_existing_provider';
import { testExistingProviderLogic } from '../test_existing_provider_logic';
import type { EmailProviderVendor } from '../../../lib/shared/schemas/email_providers';

export const testExistingProvider = action({
  args: {
    providerId: v.id('emailProviders'),
  },
  handler: async (ctx, args): Promise<TestResult> => {
    return await testExistingProviderLogic(ctx, args.providerId, {
      getProvider: async (providerId) => {
        return await ctx.runQuery(
          internal.email_providers.internal_queries.get_provider_by_id.getProviderById,
          { providerId },
        );
      },
      updateStatus: async (providerId, status, lastTestedAt, errorMessage) => {
        await ctx.runMutation(
          internal.email_providers.internal_mutations.update_provider_status.updateProviderStatus,
          { providerId, status, lastTestedAt, errorMessage },
        );
      },
      testConnection: async (params) => {
        return await ctx.runAction(
          internal.email_providers.internal_actions.test_new_provider_connection.testNewProviderConnection,
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
          api.email_providers.actions.store_oauth2_tokens.storeOAuth2Tokens,
          params,
        );
      },
      setMetadata: async (providerId, metadata) => {
        await ctx.runMutation(
          internal.email_providers.internal_mutations.update_metadata.updateMetadata,
          { providerId, metadata },
        );
      },
    });
  },
});

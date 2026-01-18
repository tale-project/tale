'use node';

/**
 * Generate OAuth2 Auth URL Public Action
 */

import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { authComponent } from '../../auth';
import { generateOAuth2AuthUrlLogic } from '../generate_oauth2_auth_url_logic';
import type { Id, Doc } from '../../_generated/dataModel';

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
          internal.email_providers.internal_queries.get_provider_by_id.getProviderById,
          { providerId },
        );
      },
      setMetadata: async (providerId, config) => {
        await ctx.runMutation(
          internal.email_providers.internal_mutations.update_metadata.updateMetadata,
          { providerId, metadata: config },
        );
      },
    });
    return { authUrl };
  },
});

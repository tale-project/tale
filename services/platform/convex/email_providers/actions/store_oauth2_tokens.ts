'use node';

/**
 * Store OAuth2 Tokens Public Action
 */

import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { authComponent } from '../../auth';
import { storeOAuth2TokensLogic } from '../store_oauth2_tokens_logic';

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
          internal.email_providers.internal_mutations.update_oauth2_tokens.updateOAuth2Tokens,
          params,
        );
      },
    });
  },
});

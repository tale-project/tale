/**
 * Internal mutation to update provider status
 */

import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { emailProviderStatusValidator } from '../validators';

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

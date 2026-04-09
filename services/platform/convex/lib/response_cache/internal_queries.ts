import { v } from 'convex/values';

import { internalQuery } from '../../_generated/server';

export const lookupCache = internalQuery({
  args: { cacheKey: v.string() },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query('llmResponseCache')
      .withIndex('by_cacheKey', (q) => q.eq('cacheKey', args.cacheKey))
      .first();
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry;
  },
});

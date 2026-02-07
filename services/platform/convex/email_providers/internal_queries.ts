import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';

export const getDefault = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('emailProviders')
      .withIndex('by_organizationId_and_isDefault', (q) =>
        q.eq('organizationId', args.organizationId).eq('isDefault', true),
      )
      .first();
  },
});

export const get = internalQuery({
  args: {
    providerId: v.id('emailProviders'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.providerId);
  },
});

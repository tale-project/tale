/**
 * Internal query to get email provider by ID
 */

import { v } from 'convex/values';
import { internalQuery } from '../../_generated/server';

export const getInternal = internalQuery({
  args: {
    providerId: v.id('emailProviders'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.providerId);
  },
});

import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

export const getThreadMetadata = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
  },
});

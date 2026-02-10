import { v } from 'convex/values';

import { internalQuery } from '../../_generated/server';

export const getWebhookByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('customAgentWebhooks')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();
  },
});

import { v } from 'convex/values';

import { query } from '../../_generated/server';

export const getWebhooks = query({
  args: { customAgentId: v.id('customAgents') },
  handler: async (ctx, args) => {
    const webhooks = await ctx.db
      .query('customAgentWebhooks')
      .withIndex('by_agent', (q) => q.eq('customAgentId', args.customAgentId))
      .collect();
    return webhooks.map((wh) => ({
      _id: wh._id,
      _creationTime: wh._creationTime,
      organizationId: wh.organizationId,
      customAgentId: wh.customAgentId,
      token: wh.token,
      isActive: wh.isActive,
      lastTriggeredAt: wh.lastTriggeredAt,
      createdAt: wh.createdAt,
      createdBy: wh.createdBy,
    }));
  },
});

import { v } from 'convex/values';

import { query } from '../../_generated/server';
import { getAuthUserIdentity } from '../../lib/rls/auth/get_auth_user_identity';

export const getWebhooks = query({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const webhookQuery = ctx.db
      .query('agentWebhooks')
      .withIndex('by_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      );

    const results = [];
    for await (const wh of webhookQuery) {
      results.push({
        _id: wh._id,
        _creationTime: wh._creationTime,
        organizationId: wh.organizationId,
        agentSlug: wh.agentSlug,
        token: wh.token,
        isActive: wh.isActive,
        lastTriggeredAt: wh.lastTriggeredAt,
        createdAt: wh.createdAt,
        createdBy: wh.createdBy,
      });
    }

    return results;
  },
});

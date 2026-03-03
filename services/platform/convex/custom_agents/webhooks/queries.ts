import { v } from 'convex/values';

import { query } from '../../_generated/server';
import { getUserTeamIds } from '../../lib/get_user_teams';
import { getAuthUserIdentity } from '../../lib/rls/auth/get_auth_user_identity';
import { hasTeamAccess } from '../../lib/team_access';

export const getWebhooks = query({
  args: { customAgentId: v.id('customAgents') },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const agent = await ctx.db.get(args.customAgentId);
    if (!agent) return [];

    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);
    if (!hasTeamAccess(agent, userTeamIds)) return [];

    const webhookQuery = ctx.db
      .query('customAgentWebhooks')
      .withIndex('by_agent', (q) => q.eq('customAgentId', args.customAgentId));

    const results = [];
    for await (const wh of webhookQuery) {
      results.push({
        _id: wh._id,
        _creationTime: wh._creationTime,
        organizationId: wh.organizationId,
        customAgentId: wh.customAgentId,
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

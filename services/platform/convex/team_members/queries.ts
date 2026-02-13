import { v } from 'convex/values';

import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';

export const listByTeam = query({
  args: {
    teamId: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.string(),
      teamId: v.string(),
      userId: v.string(),
      role: v.string(),
      joinedAt: v.number(),
      displayName: v.optional(v.string()),
      email: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser || !args.teamId) {
      return [];
    }

    const team = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'team',
      where: [{ field: '_id', value: args.teamId, operator: 'eq' }],
    });
    if (!team || typeof team.organizationId !== 'string') {
      return [];
    }

    try {
      await getOrganizationMember(ctx, team.organizationId, authUser);
    } catch {
      return [];
    }

    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'teamMember',
      paginationOpts: {
        cursor: null,
        numItems: 1000,
      },
      where: [
        {
          field: 'teamId',
          value: args.teamId,
          operator: 'eq',
        },
      ],
    });

    if (!result || result.page.length === 0) {
      return [];
    }

    const userIds = new Set<string>();
    for (const m of result.page) {
      userIds.add(String(m.userId));
    }

    const userMap = new Map<string, { name?: string; email?: string }>();
    await Promise.all(
      [...userIds].map(async (userId) => {
        const userResult = await ctx.runQuery(
          components.betterAuth.adapter.findOne,
          {
            model: 'user',
            where: [{ field: '_id', value: userId, operator: 'eq' }],
          },
        );
        if (userResult) {
          const name =
            typeof userResult.name === 'string' ? userResult.name : undefined;
          const email =
            typeof userResult.email === 'string' ? userResult.email : undefined;
          userMap.set(userId, { name, email });
        }
      }),
    );

    return result.page.map((member: Record<string, unknown>) => {
      const userId = String(member.userId);
      const user = userMap.get(userId);
      return {
        _id: String(member._id),
        teamId: String(member.teamId),
        userId,
        role: typeof member.role === 'string' ? member.role : 'member',
        joinedAt: typeof member.createdAt === 'number' ? member.createdAt : 0,
        displayName: user?.name,
        email: user?.email,
      };
    });
  },
});

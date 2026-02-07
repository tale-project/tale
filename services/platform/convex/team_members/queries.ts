import { v } from 'convex/values';
import { query } from '../_generated/server';
import { components } from '../_generated/api';
import { authComponent } from '../auth';

interface TeamMemberItem {
  _id: string;
  teamId: string;
  userId: string;
  role: string;
  joinedAt: number;
  displayName?: string;
  email?: string;
}

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
  handler: async (ctx, args): Promise<TeamMemberItem[]> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return [];
    }

    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'teamMember',
      paginationOpts: {
        cursor: null,
        numItems: 100,
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

    const seenUserIds = new Set<string>();
    for (const m of result.page) {
      seenUserIds.add(String((m as any).userId));
    }
    const uniqueUserIds = Array.from(seenUserIds);

    const userMap = new Map<string, { name?: string; email?: string }>();
    await Promise.all(
      uniqueUserIds.map(async (userId) => {
        const userResult = await ctx.runQuery(
          components.betterAuth.adapter.findOne,
          {
            model: 'user',
            where: [{ field: '_id', value: userId, operator: 'eq' }],
          },
        );
        if (userResult) {
          const name = typeof userResult.name === 'string' ? userResult.name : undefined;
          const email = typeof userResult.email === 'string' ? userResult.email : undefined;
          userMap.set(userId, { name, email });
        }
      }),
    );

    return result.page.map((member: any) => {
      const user = userMap.get(member.userId);
      return {
        _id: member._id,
        teamId: member.teamId,
        userId: member.userId,
        role: member.role || 'member',
        joinedAt: member.createdAt,
        displayName: user?.name,
        email: user?.email,
      };
    });
  },
});

/**
 * Team Members Public Queries and Mutations
 *
 * Provides team member management using Better Auth's team/teamMember tables.
 */

import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { components } from './_generated/api';
import { authComponent } from './auth';
import { getOrganizationMember } from './lib/rls';

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

    const members = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result.page.map(async (member: any) => {
        const userResult = await ctx.runQuery(
          components.betterAuth.adapter.findOne,
          {
            model: 'user',
            where: [{ field: '_id', value: member.userId, operator: 'eq' }],
          },
        );

        return {
          _id: member._id,
          teamId: member.teamId,
          userId: member.userId,
          role: member.role || 'member',
          joinedAt: member.createdAt,
          displayName: userResult?.name,
          email: userResult?.email,
        };
      }),
    );

    return members;
  },
});

export const addMember = mutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
    organizationId: v.string(),
    role: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const result = await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'teamMember',
        data: {
          teamId: args.teamId,
          userId: args.userId,
          createdAt: Date.now(),
        },
      },
    });

    return result;
  },
});

export const removeMember = mutation({
  args: {
    teamMemberId: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const memberToRemove = await ctx.runQuery(
      components.betterAuth.adapter.findOne,
      {
        model: 'teamMember',
        where: [{ field: '_id', value: args.teamMemberId, operator: 'eq' }],
      },
    );

    if (!memberToRemove) {
      throw new Error('Team member not found');
    }

    const teamId = memberToRemove.teamId as string;

    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: 'teamMember',
        where: [{ field: '_id', value: args.teamMemberId, operator: 'eq' }],
      },
    });

    const remainingMembers = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'teamMember',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: 'teamId', operator: 'eq', value: teamId }],
      },
    );

    if (!remainingMembers || remainingMembers.page.length === 0) {
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: {
          model: 'team',
          where: [{ field: '_id', value: teamId, operator: 'eq' }],
        },
      });
    }

    return { success: true };
  },
});

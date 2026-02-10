import { v } from 'convex/values';

import { components } from '../_generated/api';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

export const addMember = mutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const callerMember = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    if (callerMember.role !== 'admin' && callerMember.role !== 'owner') {
      throw new Error('Only admins can add team members');
    }

    const team = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'team',
      where: [{ field: '_id', value: args.teamId, operator: 'eq' }],
    });
    if (!team || String(team.organizationId) !== args.organizationId) {
      throw new Error('Team not found in this organization');
    }

    const targetOrgMember = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          {
            field: 'organizationId',
            value: args.organizationId,
            operator: 'eq',
          },
          { field: 'userId', value: args.userId, operator: 'eq' },
        ],
      },
    );
    if (!targetOrgMember?.page?.[0]) {
      throw new Error('User is not a member of this organization');
    }

    const existingTeamMember = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'teamMember',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'teamId', value: args.teamId, operator: 'eq' },
          { field: 'userId', value: args.userId, operator: 'eq' },
        ],
      },
    );
    if (existingTeamMember?.page?.length) {
      throw new Error('User is already a member of this team');
    }

    return await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'teamMember' as const,
        data: {
          teamId: args.teamId,
          userId: args.userId,
          createdAt: Date.now(),
        },
      },
    });
  },
});

export const removeMember = mutation({
  args: {
    teamMemberId: v.string(),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const callerMember = await getOrganizationMember(ctx, args.organizationId, {
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

    const isSelfRemoval =
      String(memberToRemove.userId) === String(authUser._id);
    if (
      callerMember.role !== 'admin' &&
      callerMember.role !== 'owner' &&
      !isSelfRemoval
    ) {
      throw new Error('Only admins can remove other team members');
    }

    const teamId = String(memberToRemove.teamId);

    const team = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'team',
      where: [{ field: '_id', value: teamId, operator: 'eq' }],
    });
    if (!team || String(team.organizationId) !== args.organizationId) {
      throw new Error('Team not found in this organization');
    }

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

    return null;
  },
});

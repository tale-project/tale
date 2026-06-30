import { ConvexError, v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-utils';
import { components } from '../_generated/api';
import { mutation } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import {
  upsertTeamMemberMirror,
  deleteTeamMemberMirrorByTeamMemberId,
} from '../members/mirror_sync';

export const addMember = mutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    const callerMember = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );

    if (!isAdmin(callerMember.role)) {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'Only admins can add team members',
      });
    }

    const team = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'team',
      where: [{ field: '_id', value: args.teamId, operator: 'eq' }],
    });
    if (!team || String(team.organizationId) !== args.organizationId) {
      throw new ConvexError({
        code: 'TEAM_NOT_FOUND',
        message: 'Team not found in this organization',
      });
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
      throw new ConvexError({
        code: 'USER_NOT_ORG_MEMBER',
        message: 'User is not a member of this organization',
      });
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
      throw new ConvexError({
        code: 'ALREADY_TEAM_MEMBER',
        message: 'User is already a member of this team',
      });
    }

    const createdAt = Date.now();
    const created = await ctx.runMutation(
      components.betterAuth.adapter.create,
      {
        input: {
          model: 'teamMember' as const,
          data: {
            teamId: args.teamId,
            userId: args.userId,
            createdAt,
          },
        },
      },
    );

    // Keep the RLS read mirror in step (same transaction as the write above).
    const teamMemberId = isRecord(created)
      ? (getString(created, '_id') ?? getString(created, 'id'))
      : undefined;
    if (teamMemberId) {
      await upsertTeamMemberMirror(ctx, {
        teamMemberId,
        userId: args.userId,
        teamId: args.teamId,
        createdAt,
      });
    }

    return created;
  },
});

export const removeMember = mutation({
  args: {
    teamMemberId: v.string(),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    const callerMember = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );

    const memberToRemove = await ctx.runQuery(
      components.betterAuth.adapter.findOne,
      {
        model: 'teamMember',
        where: [{ field: '_id', value: args.teamMemberId, operator: 'eq' }],
      },
    );

    if (!memberToRemove) {
      throw new ConvexError({
        code: 'TEAM_MEMBER_NOT_FOUND',
        message: 'Team member not found',
      });
    }

    const isSelfRemoval = String(memberToRemove.userId) === authUser.userId;
    if (!isAdmin(callerMember.role) && !isSelfRemoval) {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'Only admins can remove other team members',
      });
    }

    const teamId = String(memberToRemove.teamId);

    const team = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'team',
      where: [{ field: '_id', value: teamId, operator: 'eq' }],
    });
    if (!team || String(team.organizationId) !== args.organizationId) {
      throw new ConvexError({
        code: 'TEAM_NOT_FOUND',
        message: 'Team not found in this organization',
      });
    }

    const memberCount = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'teamMember',
        paginationOpts: { cursor: null, numItems: 2 },
        where: [{ field: 'teamId', operator: 'eq', value: teamId }],
      },
    );

    if (!memberCount || memberCount.page.length <= 1) {
      throw new ConvexError({
        code: 'LAST_TEAM_MEMBER',
        message: 'Cannot remove the last team member. Delete the team instead.',
      });
    }

    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: 'teamMember',
        where: [{ field: '_id', value: args.teamMemberId, operator: 'eq' }],
      },
    });

    // Drop the RLS read mirror row in the same transaction.
    await deleteTeamMemberMirrorByTeamMemberId(ctx, args.teamMemberId);

    return null;
  },
});

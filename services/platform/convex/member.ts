/**
 * Member Queries
 *
 * Public queries for member/team operations.
 * This module provides access to team and member data for the frontend.
 */

import { v } from 'convex/values';
import { query } from './_generated/server';
import { components } from './_generated/api';
import { authComponent } from './auth';

interface BetterAuthTeam {
  _id: string;
  name: string;
  organizationId: string;
  createdAt?: number | null;
}

interface BetterAuthTeamMember {
  _id: string;
  teamId: string;
  userId: string;
  createdAt?: number | null;
}

interface BetterAuthFindManyResult<T> {
  page: T[];
  continueCursor?: string;
  isDone?: boolean;
}

export const getMyTeams = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.object({
    teams: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return { teams: [] };
    }

    // Get all team memberships for this user
    const membershipsResult: BetterAuthFindManyResult<BetterAuthTeamMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'teamMember',
        paginationOpts: { cursor: null, numItems: 100 },
        where: [{ field: 'userId', operator: 'eq', value: String(authUser._id) }],
      });

    if (!membershipsResult || membershipsResult.page.length === 0) {
      return { teams: [] };
    }

    // Get team details for each membership
    const teamIds = membershipsResult.page.map((m) => m.teamId);
    const teams: Array<{ id: string; name: string }> = [];

    for (const teamId of teamIds) {
      const teamResult: BetterAuthFindManyResult<BetterAuthTeam> = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'team',
          paginationOpts: { cursor: null, numItems: 1 },
          where: [
            { field: '_id', operator: 'eq', value: teamId },
            { field: 'organizationId', operator: 'eq', value: args.organizationId },
          ],
        },
      );

      if (teamResult && teamResult.page.length > 0) {
        const team = teamResult.page[0];
        teams.push({
          id: team._id,
          name: team.name,
        });
      }
    }

    return { teams };
  },
});

export const listByOrganization = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.string(),
      organizationId: v.string(),
      userId: v.string(),
      role: v.string(),
      createdAt: v.number(),
      displayName: v.optional(v.string()),
      email: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return [];
    }

    // Query all members of the organization
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: {
        cursor: null,
        numItems: 100,
      },
      where: [
        {
          field: 'organizationId',
          value: args.organizationId,
          operator: 'eq',
        },
      ],
    });

    if (!result || result.page.length === 0) {
      return [];
    }

    // Get user details for each member
    const members = await Promise.all(
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
          organizationId: member.organizationId,
          userId: member.userId,
          role: member.role || 'member',
          createdAt: member.createdAt,
          displayName: userResult?.name,
          email: userResult?.email,
        };
      }),
    );

    return members;
  },
});

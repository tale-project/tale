import { v } from 'convex/values';
import { internalQuery, query } from '../_generated/server';
import { components } from '../_generated/api';
import { authComponent } from '../auth';
import { getOrganizationMember, getUserOrganizations } from '../lib/rls';
import type { BetterAuthFindManyResult, BetterAuthMember } from './types';

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

const VALID_ROLES = ['disabled', 'member', 'editor', 'developer', 'admin'] as const;
type ValidRole = (typeof VALID_ROLES)[number];

function isValidRole(role: string): role is ValidRole {
  return VALID_ROLES.includes(role as ValidRole);
}

export const getMemberRole = internalQuery({
  args: {
    userId: v.string(),
    organizationId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const result: BetterAuthFindManyResult<BetterAuthMember> = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'organizationId', value: args.organizationId, operator: 'eq' },
          { field: 'userId', value: args.userId, operator: 'eq' },
        ],
      },
    );

    return result?.page?.[0]?.role ?? null;
  },
});

export const getCurrentMemberContext = query({
  args: { organizationId: v.string() },
  returns: v.union(
    v.object({
      memberId: v.string(),
      organizationId: v.string(),
      userId: v.string(),
      role: v.union(
        v.literal('admin'),
        v.literal('member'),
        v.literal('editor'),
        v.literal('developer'),
        v.literal('disabled'),
      ),
      createdAt: v.number(),
      displayName: v.optional(v.string()),
      isAdmin: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    let authUser;
    try {
      authUser = await authComponent.getAuthUser(ctx);
    } catch {
      return null;
    }
    if (!authUser) {
      return null;
    }

    try {
      const member = await getOrganizationMember(ctx, args.organizationId, {
        userId: authUser._id,
        email: authUser.email,
        name: authUser.name,
      });

      if (!member) {
        return null;
      }

      const role = isValidRole(member.role) ? member.role : 'member';

      return {
        memberId: member._id,
        organizationId: member.organizationId,
        userId: member.userId,
        role,
        createdAt: member.createdAt,
        displayName: authUser.name,
        isAdmin: role === 'admin',
      };
    } catch {
      return null;
    }
  },
});

export const listByOrganization = query({
  args: { organizationId: v.string() },
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
    let authUser;
    try {
      authUser = await authComponent.getAuthUser(ctx);
    } catch {
      return [];
    }
    if (!authUser) {
      return [];
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      });
    } catch {
      return [];
    }

    const result: BetterAuthFindManyResult<BetterAuthMember> = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 100 },
        where: [{ field: 'organizationId', value: args.organizationId, operator: 'eq' }],
      },
    );

    if (!result || result.page.length === 0) {
      return [];
    }

    return Promise.all(
      result.page.map(async (member) => {
        const userResult = await ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: 'user',
          where: [{ field: '_id', value: member.userId, operator: 'eq' }],
        });

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
  },
});

export const getUserIdByEmail = query({
  args: { email: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    let authUser;
    try {
      authUser = await authComponent.getAuthUser(ctx);
    } catch {
      return null;
    }
    if (!authUser) {
      return null;
    }

    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: 'email', value: args.email, operator: 'eq' }],
    });

    return result?.page?.[0]?._id ?? null;
  },
});

export const getUserOrganizationsList = query({
  args: {},
  returns: v.array(
    v.object({
      organizationId: v.string(),
      role: v.string(),
    }),
  ),
  handler: async (ctx) => {
    let authUser;
    try {
      authUser = await authComponent.getAuthUser(ctx);
    } catch {
      return [];
    }
    if (!authUser) {
      return [];
    }

    const orgs = await getUserOrganizations(ctx, {
      userId: authUser._id,
      email: authUser.email,
      name: authUser.name,
    });

    return orgs.map((o) => ({
      organizationId: o.organizationId,
      role: o.role,
    }));
  },
});

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

    const membershipsResult: BetterAuthFindManyResult<BetterAuthTeamMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'teamMember',
        paginationOpts: { cursor: null, numItems: 100 },
        where: [{ field: 'userId', operator: 'eq', value: String(authUser._id) }],
      });

    if (!membershipsResult || membershipsResult.page.length === 0) {
      return { teams: [] };
    }

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

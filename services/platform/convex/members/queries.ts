import { v } from 'convex/values';

import type { MemberRole } from '../../lib/shared/schemas/organizations';
import type { BetterAuthFindManyResult, BetterAuthMember } from './types';

import { components } from '../_generated/api';
import { query, QueryCtx } from '../_generated/server';
import {
  getAuthUserIdentity,
  getOrganizationMember,
  getUserOrganizations,
} from '../lib/rls';
import { UnauthorizedError } from '../lib/rls/errors';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { memberRoleValidator } from './validators';

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

const VALID_ROLES = new Set<string>([
  'owner',
  'disabled',
  'member',
  'editor',
  'developer',
  'admin',
]);

function isValidRole(role: string): role is MemberRole {
  return VALID_ROLES.has(role);
}

export const getCurrentMemberContext = query({
  args: { organizationId: v.string() },
  returns: v.union(
    v.object({
      memberId: v.string(),
      organizationId: v.string(),
      userId: v.string(),
      role: memberRoleValidator,
      createdAt: v.number(),
      displayName: v.optional(v.string()),
      isAdmin: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return null;
    }

    try {
      const member = await getOrganizationMember(
        ctx,
        args.organizationId,
        authUser,
      );

      const role = isValidRole(member.role) ? member.role : 'member';

      return {
        memberId: member._id,
        organizationId: member.organizationId,
        userId: member.userId,
        role,
        createdAt: member.createdAt,
        displayName: authUser.name,
        isAdmin: isAdmin(role),
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return null;
      }
      throw error;
    }
  },
});

export async function listByOrganizationHandler(
  ctx: QueryCtx,
  args: { organizationId: string },
) {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    return [];
  }

  try {
    await getOrganizationMember(ctx, args.organizationId, authUser);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return [];
    }
    throw error;
  }

  const result: BetterAuthFindManyResult<BetterAuthMember> = await ctx.runQuery(
    components.betterAuth.adapter.findMany,
    {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 100 },
      where: [
        {
          field: 'organizationId',
          value: args.organizationId,
          operator: 'eq',
        },
      ],
    },
  );

  if (!result || result.page.length === 0) {
    return [];
  }

  return Promise.all(
    result.page.map(async (member) => {
      let displayName: string | undefined;
      let email: string | undefined;
      try {
        const userResult = await ctx.runQuery(
          components.betterAuth.adapter.findOne,
          {
            model: 'user',
            where: [{ field: '_id', value: member.userId, operator: 'eq' }],
          },
        );
        displayName = userResult?.name;
        email = userResult?.email;
      } catch (error) {
        console.warn(
          '[Members] Failed to fetch user details',
          member.userId,
          error,
        );
      }

      const role: MemberRole = isValidRole(member.role)
        ? member.role
        : 'member';

      return {
        _id: member._id,
        organizationId: member.organizationId,
        userId: member.userId,
        role,
        createdAt: member.createdAt,
        displayName,
        email,
      };
    }),
  );
}

export const listByOrganization = query({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      _id: v.string(),
      organizationId: v.string(),
      userId: v.string(),
      role: memberRoleValidator,
      createdAt: v.number(),
      displayName: v.optional(v.string()),
      email: v.optional(v.string()),
    }),
  ),
  handler: listByOrganizationHandler,
});

export const getUserIdByEmail = query({
  args: { email: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
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
      role: memberRoleValidator,
    }),
  ),
  handler: async (ctx) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return [];
    }

    const orgs = await getUserOrganizations(ctx, authUser);

    return orgs.map((o) => ({
      organizationId: o.organizationId,
      role: o.role,
    }));
  },
});

export async function approxCountMyTeamsHandler(
  ctx: QueryCtx,
  args: { organizationId: string },
) {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    return 0;
  }

  const membershipsResult: BetterAuthFindManyResult<BetterAuthTeamMember> =
    await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'teamMember',
      paginationOpts: { cursor: null, numItems: 100 },
      where: [{ field: 'userId', operator: 'eq', value: authUser.userId }],
    });

  if (!membershipsResult || membershipsResult.page.length === 0) {
    return 0;
  }

  const teamResults: (BetterAuthFindManyResult<BetterAuthTeam> | null)[] =
    await Promise.all(
      membershipsResult.page.map(async (membership) => {
        try {
          return await ctx.runQuery(components.betterAuth.adapter.findMany, {
            model: 'team',
            paginationOpts: { cursor: null, numItems: 1 },
            where: [
              { field: '_id', operator: 'eq', value: membership.teamId },
              {
                field: 'organizationId',
                operator: 'eq',
                value: args.organizationId,
              },
            ],
          });
        } catch (error) {
          console.warn(
            '[Members] Failed to look up team',
            membership.teamId,
            error,
          );
          return null;
        }
      }),
    );

  return teamResults.filter((r) => r && r.page.length > 0).length;
}

export const approxCountMyTeams = query({
  args: { organizationId: v.string() },
  returns: v.number(),
  handler: approxCountMyTeamsHandler,
});

export async function getMyTeamsHandler(
  ctx: QueryCtx,
  args: { organizationId: string },
) {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    return [];
  }

  const membershipsResult: BetterAuthFindManyResult<BetterAuthTeamMember> =
    await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'teamMember',
      paginationOpts: { cursor: null, numItems: 100 },
      where: [{ field: 'userId', operator: 'eq', value: authUser.userId }],
    });

  if (!membershipsResult || membershipsResult.page.length === 0) {
    return [];
  }

  const teamIds = membershipsResult.page.map((m) => m.teamId);

  const teamResults: (BetterAuthFindManyResult<BetterAuthTeam> | null)[] =
    await Promise.all(
      teamIds.map(async (teamId) => {
        try {
          return await ctx.runQuery(components.betterAuth.adapter.findMany, {
            model: 'team',
            paginationOpts: { cursor: null, numItems: 1 },
            where: [
              { field: '_id', operator: 'eq', value: teamId },
              {
                field: 'organizationId',
                operator: 'eq',
                value: args.organizationId,
              },
            ],
          });
        } catch (error) {
          console.warn('[Members] Failed to look up team', teamId, error);
          return null;
        }
      }),
    );

  const teams: Array<{ id: string; name: string }> = [];
  for (const teamResult of teamResults) {
    if (teamResult && teamResult.page.length > 0) {
      const team = teamResult.page[0];
      teams.push({
        id: team._id,
        name: team.name,
      });
    }
  }

  return teams;
}

export const getMyTeams = query({
  args: { organizationId: v.string() },
  returns: v.array(v.object({ id: v.string(), name: v.string() })),
  handler: getMyTeamsHandler,
});

export async function listOrgTeamsHandler(
  ctx: QueryCtx,
  args: { organizationId: string },
) {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    return [];
  }

  const member = await getOrganizationMember(
    ctx,
    args.organizationId,
    authUser,
  );

  if (!isAdmin(member.role)) {
    return getMyTeamsHandler(ctx, args);
  }

  const teamsResult: BetterAuthFindManyResult<BetterAuthTeam> =
    await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'team',
      paginationOpts: { cursor: null, numItems: 100 },
      where: [
        {
          field: 'organizationId',
          operator: 'eq',
          value: args.organizationId,
        },
      ],
    });

  if (!teamsResult || teamsResult.page.length === 0) {
    return [];
  }

  return teamsResult.page.map((team) => ({
    id: team._id,
    name: team.name,
  }));
}

export const listOrgTeams = query({
  args: { organizationId: v.string() },
  returns: v.array(v.object({ id: v.string(), name: v.string() })),
  handler: listOrgTeamsHandler,
});

/**
 * Members Queries
 *
 * Internal and public queries for member operations.
 * Member data is stored in Better Auth's `member` table.
 */

import { v } from 'convex/values';
import { internalQuery, query } from '../_generated/server';
import { components } from '../_generated/api';
import { authComponent } from '../auth';
import { getOrganizationMember, getUserOrganizations } from '../lib/rls';

const VALID_ROLES = ['disabled', 'member', 'editor', 'developer', 'admin'] as const;
type ValidRole = (typeof VALID_ROLES)[number];

function isValidRole(role: string): role is ValidRole {
  return VALID_ROLES.includes(role as ValidRole);
}

/**
 * Get a member's role in an organization (internal query)
 * Returns the role string or null if the member doesn't exist
 */
export const getMemberRoleInternal = internalQuery({
  args: {
    userId: v.string(),
    organizationId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: {
        cursor: null,
        numItems: 1,
      },
      where: [
        { field: 'organizationId', value: args.organizationId, operator: 'eq' },
        { field: 'userId', value: args.userId, operator: 'eq' },
      ],
    });

    const member = result?.page?.[0];
     
    return (member as any)?.role ?? null;
  },
});

// =============================================================================
// PUBLIC QUERIES (for frontend via api.queries.member.*)
// =============================================================================

/**
 * Get the current user's member context for an organization.
 * Returns the member's role and organization ID.
 */
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
      const isAdmin = role === 'admin';

      return {
        memberId: member._id,
        organizationId: member.organizationId,
        userId: member.userId,
        role,
        createdAt: member.createdAt,
        displayName: authUser.name,
        isAdmin,
      };
    } catch {
      return null;
    }
  },
});

/**
 * List all members of an organization.
 */
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

    // Verify user has access to this organization
    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      });
    } catch {
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

/**
 * Get user ID by email.
 */
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
      paginationOpts: {
        cursor: null,
        numItems: 1,
      },
      where: [
        {
          field: 'email',
          value: args.email,
          operator: 'eq',
        },
      ],
    });

    return result?.page?.[0]?._id ?? null;
  },
});

/**
 * Get all organizations for the current user.
 */
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

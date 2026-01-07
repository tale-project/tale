import { v } from 'convex/values';
import { queryWithRLS, mutationWithRLS, getAuthenticatedUser } from './lib/rls';
import { query, internalQuery } from './_generated/server';
import { components } from './_generated/api';

// Import validators and types from model
import {
  sortOrderValidator,
  memberListItemValidator,
  memberContextValidator,
  addMemberResponseValidator,
} from './model/members/validators';
import type {
  BetterAuthMember,
  BetterAuthUser,
  BetterAuthCreateResult,
} from './model/members/types';

/**
 * Public query to get user ID by email (for adding existing users to organizations).
 *
 * Architecture:
 * - Better Auth manages authentication and stores user credentials
 * - We store Better Auth's internal user ID (_id) as identityId in our members table
 * - This links our member records to Better Auth users
 */
export const getUserIdByEmail = query({
  args: {
    email: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    // Query Better Auth's user table to find user by email
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

    if (result && result.page.length > 0) {
      // Return Better Auth's internal user ID (_id)
      return result.page[0]._id;
    }

    return null;
  },
});

export const listByOrganization = queryWithRLS({
  args: {
    organizationId: v.string(),
    sortOrder: v.optional(sortOrderValidator),
    search: v.optional(v.string()),
  },
  returns: v.array(memberListItemValidator),
  handler: async (ctx, args) => {
    // RLS handles authorization automatically
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1000 },
      where: [
        { field: 'organizationId', value: args.organizationId, operator: 'eq' },
      ],
    });

    const members = result?.page ?? [];
    const searchLower = args.search?.trim().toLowerCase();

    // Enrich with user info for email/displayName
    const enriched = await Promise.all(
      (members as BetterAuthMember[]).map(async (m) => {
        const userRes = await ctx.runQuery(
          components.betterAuth.adapter.findMany,
          {
            model: 'user',
            paginationOpts: { cursor: null, numItems: 1 },
            where: [{ field: '_id', value: m.userId, operator: 'eq' }],
          },
        );
        const user = userRes?.page?.[0] as BetterAuthUser | undefined;
        return {
          _id: m._id,
          _creationTime: m.createdAt,
          organizationId: m.organizationId,
          identityId: m.userId,
          email: user?.email,
          role: m.role,
          displayName: user?.name ?? undefined,
          metadata: undefined,
        };
      }),
    );

    // Apply search filter if provided
    const filtered = searchLower
      ? enriched.filter((member) => {
          return (
            member.email?.toLowerCase().includes(searchLower) ||
            member.displayName?.toLowerCase().includes(searchLower) ||
            member.role?.toLowerCase().includes(searchLower)
          );
        })
      : enriched;

    // Sort members by name (displayName or email)
    const sorted = filtered.sort((a, b) => {
      const aName = a.displayName || a.email || '';
      const bName = b.displayName || b.email || '';
      const comparison = aName.localeCompare(bName);
      return args.sortOrder === 'desc' ? -comparison : comparison;
    });

    return sorted;
  },
});

export const getCurrentMemberContext = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: memberContextValidator,
  handler: async (ctx, args) => {
    // Get current authenticated user through RLS context
    const authUser = await getAuthenticatedUser(ctx);
    const trustedHeadersEnabled =
      process.env.TRUSTED_HEADERS_ENABLED === 'true';
    if (!authUser) {
      return {
        member: null,
        role: null,
        isAdmin: false,
        canManageMembers: false,
        canChangePassword: !trustedHeadersEnabled,
      };
    }

    // Try to find membership by userId
    let memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'organizationId', value: args.organizationId, operator: 'eq' },
        { field: 'userId', value: authUser.userId, operator: 'eq' },
      ],
    });

    let member = memberRes?.page?.[0] as BetterAuthMember | undefined;

    // Fallback to email lookup if no direct match
    if (!member && authUser.email) {
      const userRes = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'user',
          paginationOpts: { cursor: null, numItems: 1 },
          where: [{ field: 'email', value: authUser.email, operator: 'eq' }],
        },
      );
      const user = userRes?.page?.[0];
      if (user?._id) {
        memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: 'member',
          paginationOpts: { cursor: null, numItems: 1 },
          where: [
            {
              field: 'organizationId',
              value: args.organizationId,
              operator: 'eq',
            },
            { field: 'userId', value: user._id, operator: 'eq' },
          ],
        });
        member = memberRes?.page?.[0] as BetterAuthMember | undefined;
      }
    }

    if (!member) {
      return {
        member: null,
        role: null,
        isAdmin: false,
        canManageMembers: false,
        canChangePassword: !trustedHeadersEnabled,
      };
    }

    // Load user details for email/displayName
    const userRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: member.userId, operator: 'eq' }],
    });
    const user = userRes?.page?.[0];

    const role = (member.role ?? 'member').toLowerCase();
    const isAdmin = role === 'admin';
    const canManageMembers = isAdmin && !trustedHeadersEnabled;
    const canChangePassword = !trustedHeadersEnabled;

    return {
      member: {
        _id: member._id,
        _creationTime: member.createdAt,
        organizationId: member.organizationId,
        identityId: member.userId,
        email: user?.email,
        role: member.role,
        displayName: user?.name,
      },
      role: member.role ?? null,
      isAdmin,
      canManageMembers,
      canChangePassword,
    };
  },
});

export const addMember = mutationWithRLS({
  args: {
    organizationId: v.string(),
    email: v.string(),
    userId: v.string(), // Better Auth user _id
    role: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  returns: addMemberResponseValidator,
  handler: async (ctx, args) => {
    const trustedHeadersEnabled =
      process.env.TRUSTED_HEADERS_ENABLED === 'true';
    if (trustedHeadersEnabled) {
      throw new Error(
        'Organization membership is managed by your identity provider and cannot be edited here.',
      );
    }
    // Get current authenticated user
    const authUser = await getAuthenticatedUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    // Ensure the caller is a member and has admin privileges
    const currentMemberRes = await ctx.runQuery(
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
          { field: 'userId', value: authUser.userId, operator: 'eq' },
        ],
      },
    );
    const currentMember = currentMemberRes?.page?.[0] as BetterAuthMember | undefined;
    if (!currentMember) {
      throw new Error('You are not a member of this organization');
    }
    const callerRole = (currentMember.role ?? 'member').toLowerCase();
    if (callerRole !== 'admin') {
      throw new Error('Only Admins can add members');
    }

    // Check if user is already a member of this organization by userId
    const existingByUser = await ctx.runQuery(
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
    if ((existingByUser?.page?.length ?? 0) > 0) {
      throw new Error('User is already a member of this organization');
    }

    // Check if email is already used in this organization
    const userByEmail = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'user',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: 'email', value: args.email, operator: 'eq' }],
      },
    );
    const existingUser = userByEmail?.page?.[0];
    if (existingUser?._id) {
      const membershipByEmail = await ctx.runQuery(
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
            { field: 'userId', value: existingUser._id, operator: 'eq' },
          ],
        },
      );
      if ((membershipByEmail?.page?.length ?? 0) > 0) {
        throw new Error(
          'A member with this email already exists in this organization',
        );
      }
    }

    // Create member record in Better Auth
    const normalizedRole = (args.role ?? 'member').toLowerCase();
    const created = await ctx.runMutation(
      components.betterAuth.adapter.create,
      {
        input: {
          model: 'member',
          data: {
            organizationId: args.organizationId,
            userId: args.userId,
            role: normalizedRole,
            createdAt: Date.now(),
          },
        },
      },
    );
    const createdResult = created as BetterAuthCreateResult;
    const memberId = createdResult._id ?? createdResult.id ?? String(created);

    return { memberId };
  },
});

export const updateMemberRole = mutationWithRLS({
  args: {
    memberId: v.string(),
    role: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const trustedHeadersEnabled =
      process.env.TRUSTED_HEADERS_ENABLED === 'true';
    if (trustedHeadersEnabled) {
      throw new Error(
        'Organization membership is managed by your identity provider and cannot be edited here.',
      );
    }
    // Load the target member
    const memberRes = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
      },
    );
    const member = memberRes?.page?.[0] as BetterAuthMember | undefined;
    if (!member) {
      throw new Error('Member not found');
    }

    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error('Not authenticated');
    }

    // Prevent users from changing their own role
    if (member.userId === currentUser.userId) {
      throw new Error('You cannot change your own role');
    }

    // If demoting an admin, ensure at least 2 admins will remain
    const newRole = args.role.toLowerCase();
    const isDemotionFromAdmin = member.role === 'admin' && newRole !== 'admin';
    if (isDemotionFromAdmin) {
      const adminsRes = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'member',
          paginationOpts: { cursor: null, numItems: 1000 },
          where: [
            {
              field: 'organizationId',
              value: member.organizationId,
              operator: 'eq',
            },
            { field: 'role', value: 'admin', operator: 'eq' },
          ],
        },
      );
      const currentAdminCount = adminsRes?.page?.length ?? 0;
      if (currentAdminCount <= 2) {
        throw new Error(
          'Cannot demote this Admin. Your organization must have at least 2 Admins for security.',
        );
      }
    }

    // Update role in Better Auth
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'member',
        update: { role: newRole },
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });

    // TODO: Add audit log entry in a dedicated audit table (not wfLogs)
    return null;
  },
});

export const removeMember = mutationWithRLS({
  args: {
    memberId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const trustedHeadersEnabled =
      process.env.TRUSTED_HEADERS_ENABLED === 'true';
    if (trustedHeadersEnabled) {
      throw new Error(
        'Organization membership is managed by your identity provider and cannot be edited here.',
      );
    }
    // Load the target member
    const memberRes = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
      },
    );
    const member = memberRes?.page?.[0] as BetterAuthMember | undefined;
    if (!member) {
      throw new Error('Member not found');
    }

    const currentUser = await getAuthenticatedUser(ctx);
    if (!currentUser) {
      throw new Error('Not authenticated');
    }

    // Prevent users from deleting themselves
    if (member.userId === currentUser.userId) {
      throw new Error('You cannot delete yourself from the organization');
    }

    // If removing an admin, ensure at least 2 admins will remain
    if (member.role === 'admin') {
      const adminsRes = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'member',
          paginationOpts: { cursor: null, numItems: 1000 },
          where: [
            {
              field: 'organizationId',
              value: member.organizationId,
              operator: 'eq',
            },
            { field: 'role', value: 'admin', operator: 'eq' },
          ],
        },
      );
      const currentAdminCount = adminsRes?.page?.length ?? 0;
      if (currentAdminCount <= 2) {
        throw new Error(
          'Cannot remove this Admin. Your organization must have at least 2 Admins for security.',
        );
      }
    }

    // Check if this user is a member of any other organizations
    const userId = member.userId;
    if (userId) {
      const otherMembershipsRes = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'member',
          paginationOpts: { cursor: null, numItems: 2 },
          where: [{ field: 'userId', value: userId, operator: 'eq' }],
        },
      );

      // If this is their only organization membership, delete the user account
      if ((otherMembershipsRes?.page?.length ?? 0) <= 1) {
        await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
          input: {
            model: 'user',
            where: [{ field: '_id', value: userId, operator: 'eq' }],
          },
          paginationOpts: { cursor: null, numItems: 1 },
        });
      }
    }

    // Remove member from organization
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: {
        model: 'member',
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });

    // TODO: Add audit log entry in a dedicated audit table (not wfLogs)
    return null;
  },
});

/**
 * Get member role by userId and organizationId (internal)
 * Used by agent tools to check user permissions
 */
export const getMemberRoleInternal = internalQuery({
  args: {
    userId: v.string(),
    organizationId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'organizationId', value: args.organizationId, operator: 'eq' },
        { field: 'userId', value: args.userId, operator: 'eq' },
      ],
    });

    const member = memberRes?.page?.[0] as BetterAuthMember | undefined;
    return member?.role ?? null;
  },
});

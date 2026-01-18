/**
 * Members Mutations
 *
 * Public mutations for member operations.
 */

import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import { components } from '../_generated/api';
import { authComponent } from '../auth';
import { memberRoleValidator } from './validators';

export const addMember = mutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    role: v.optional(memberRoleValidator),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    // Check caller is admin of the organization
    const callerMemberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'organizationId', value: args.organizationId, operator: 'eq' },
        { field: 'userId', value: String(authUser._id), operator: 'eq' },
      ],
    });
    const callerMember = callerMemberRes?.page?.[0] as { role?: string } | undefined;
    if ((callerMember?.role ?? '').toLowerCase() !== 'admin') {
      throw new Error('Only Admins can add members');
    }

    const created = await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'member',
        data: {
          organizationId: args.organizationId,
          userId: args.userId,
          role: (args.role ?? 'member').toLowerCase(),
          createdAt: Date.now(),
        },
      },
    });

    return String((created as { _id?: string })?._id ?? created);
  },
});

export const removeMember = mutation({
  args: {
    memberId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    // Get member to find its organization
    const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
    });
    const member = memberRes?.page?.[0] as { organizationId?: string } | undefined;
    if (!member?.organizationId) {
      throw new Error('Member not found');
    }

    // Check caller is admin
    const callerMemberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'organizationId', value: member.organizationId, operator: 'eq' },
        { field: 'userId', value: String(authUser._id), operator: 'eq' },
      ],
    });
    const callerMember = callerMemberRes?.page?.[0] as { role?: string } | undefined;
    if ((callerMember?.role ?? '').toLowerCase() !== 'admin') {
      throw new Error('Only Admins can remove members');
    }

    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: 'member',
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
      },
    });

    return null;
  },
});

export const updateMemberRole = mutation({
  args: {
    memberId: v.string(),
    role: memberRoleValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    // Get member to find its organization
    const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
    });
    const member = memberRes?.page?.[0] as { organizationId?: string } | undefined;
    if (!member?.organizationId) {
      throw new Error('Member not found');
    }

    // Check caller is admin
    const callerMemberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'organizationId', value: member.organizationId, operator: 'eq' },
        { field: 'userId', value: String(authUser._id), operator: 'eq' },
      ],
    });
    const callerMember = callerMemberRes?.page?.[0] as { role?: string } | undefined;
    if ((callerMember?.role ?? '').toLowerCase() !== 'admin') {
      throw new Error('Only Admins can update member roles');
    }

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'member' as const,
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
        update: { role: args.role.toLowerCase() },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });

    return null;
  },
});

export const updateMemberDisplayName = mutation({
  args: {
    memberId: v.string(),
    displayName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    // Get member to verify it exists and find userId
    const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
    });
    const member = memberRes?.page?.[0] as { userId?: string; organizationId?: string } | undefined;
    if (!member?.userId || !member.organizationId) {
      throw new Error('Member not found');
    }

    // Check caller is admin or updating their own name
    const isOwnProfile = String(authUser._id) === member.userId;
    if (!isOwnProfile) {
      const callerMemberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'organizationId', value: member.organizationId, operator: 'eq' },
          { field: 'userId', value: String(authUser._id), operator: 'eq' },
        ],
      });
      const callerMember = callerMemberRes?.page?.[0] as { role?: string } | undefined;
      if ((callerMember?.role ?? '').toLowerCase() !== 'admin') {
        throw new Error('Only Admins can update other members names');
      }
    }

    // Update user's name in Better Auth users table
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'user' as const,
        where: [{ field: '_id', value: member.userId, operator: 'eq' }],
        update: { name: args.displayName },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });

    return null;
  },
});

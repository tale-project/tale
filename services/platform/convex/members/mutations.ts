/**
 * Members Mutations
 *
 * Public mutations for member operations.
 */

import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import { components } from '../_generated/api';
import { authComponent } from '../auth';
import * as AuditLogHelpers from '../audit_logs/helpers';
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

    const targetUserRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: args.userId, operator: 'eq' }],
    });
    const targetUser = targetUserRes?.page?.[0] as { email?: string; name?: string } | undefined;

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

    const memberId = String((created as { _id?: string })?._id ?? created);

    await AuditLogHelpers.logSuccess(
      ctx,
      {
        organizationId: args.organizationId,
        actor: {
          id: String(authUser._id),
          email: authUser.email,
          role: callerMember?.role,
          type: 'user',
        },
      },
      'add_member',
      'member',
      'member',
      memberId,
      targetUser?.email ?? targetUser?.name ?? args.userId,
      undefined,
      {
        userId: args.userId,
        role: (args.role ?? 'member').toLowerCase(),
      },
    );

    return memberId;
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

    const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
    });
    const member = memberRes?.page?.[0] as {
      organizationId?: string;
      userId?: string;
      role?: string;
    } | undefined;
    if (!member?.organizationId) {
      throw new Error('Member not found');
    }

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

    let targetUserEmail: string | undefined;
    if (member.userId) {
      const targetUserRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: '_id', value: member.userId, operator: 'eq' }],
      });
      const targetUser = targetUserRes?.page?.[0] as { email?: string } | undefined;
      targetUserEmail = targetUser?.email;
    }

    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: 'member',
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
      },
    });

    await AuditLogHelpers.logSuccess(
      ctx,
      {
        organizationId: member.organizationId,
        actor: {
          id: String(authUser._id),
          email: authUser.email,
          role: callerMember?.role,
          type: 'user',
        },
      },
      'remove_member',
      'member',
      'member',
      args.memberId,
      targetUserEmail ?? member.userId,
      { userId: member.userId, role: member.role },
      undefined,
    );

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

    const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
    });
    const member = memberRes?.page?.[0] as {
      organizationId?: string;
      userId?: string;
      role?: string;
    } | undefined;
    if (!member?.organizationId) {
      throw new Error('Member not found');
    }

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

    let targetUserEmail: string | undefined;
    if (member.userId) {
      const targetUserRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: '_id', value: member.userId, operator: 'eq' }],
      });
      const targetUser = targetUserRes?.page?.[0] as { email?: string } | undefined;
      targetUserEmail = targetUser?.email;
    }

    const previousRole = member.role;
    const newRole = args.role.toLowerCase();

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'member' as const,
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
        update: { role: newRole },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });

    await AuditLogHelpers.logSuccess(
      ctx,
      {
        organizationId: member.organizationId,
        actor: {
          id: String(authUser._id),
          email: authUser.email,
          role: callerMember?.role,
          type: 'user',
        },
      },
      'update_member_role',
      'member',
      'member',
      args.memberId,
      targetUserEmail ?? member.userId,
      { role: previousRole },
      { role: newRole },
    );

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

    const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
    });
    const member = memberRes?.page?.[0] as { userId?: string; organizationId?: string } | undefined;
    if (!member?.userId || !member.organizationId) {
      throw new Error('Member not found');
    }

    const targetUserRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: member.userId, operator: 'eq' }],
    });
    const targetUser = targetUserRes?.page?.[0] as { email?: string; name?: string } | undefined;
    const previousName = targetUser?.name;

    let callerRole: string | undefined;
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
      callerRole = callerMember?.role;
      if ((callerMember?.role ?? '').toLowerCase() !== 'admin') {
        throw new Error('Only Admins can update other members names');
      }
    }

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'user' as const,
        where: [{ field: '_id', value: member.userId, operator: 'eq' }],
        update: { name: args.displayName },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });

    await AuditLogHelpers.logSuccess(
      ctx,
      {
        organizationId: member.organizationId,
        actor: {
          id: String(authUser._id),
          email: authUser.email,
          role: callerRole,
          type: 'user',
        },
      },
      'update_member_name',
      'member',
      'member',
      args.memberId,
      targetUser?.email ?? member.userId,
      { name: previousName },
      { name: args.displayName },
    );

    return null;
  },
});

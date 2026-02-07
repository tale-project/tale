import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import { components } from '../_generated/api';
import { authComponent } from '../auth';
import * as AuditLogHelpers from '../audit_logs/helpers';
import type { BetterAuthMember, BetterAuthUser, BetterAuthCreateResult, BetterAuthFindManyResult } from './types';
import { memberRoleValidator } from './validators';

function findOneMember(res: BetterAuthFindManyResult<BetterAuthMember> | undefined) {
  return res?.page?.[0];
}

function findOneUser(res: BetterAuthFindManyResult<BetterAuthUser> | undefined) {
  return res?.page?.[0];
}

function isBetterAuthCreateResult(value: unknown): value is BetterAuthCreateResult {
  return typeof value === 'object' && value !== null && '_id' in value;
}

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

    const callerMember = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'organizationId', value: args.organizationId, operator: 'eq' },
          { field: 'userId', value: String(authUser._id), operator: 'eq' },
        ],
      }),
    );
    if (callerMember?.role?.toLowerCase() !== 'admin') {
      throw new Error('Only Admins can add members');
    }

    const targetUser = findOneUser(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: '_id', value: args.userId, operator: 'eq' }],
      }),
    );

    const role = (args.role ?? 'member').toLowerCase();
    const created = await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'member',
        data: {
          organizationId: args.organizationId,
          userId: args.userId,
          role,
          createdAt: Date.now(),
        },
      },
    });

    const memberId = String(isBetterAuthCreateResult(created) ? created._id : created);

    await AuditLogHelpers.logSuccess(
      ctx,
      {
        organizationId: args.organizationId,
        actor: {
          id: String(authUser._id),
          email: authUser.email,
          role: callerMember.role,
          type: 'user',
        },
      },
      'add_member',
      'member',
      'member',
      memberId,
      targetUser?.email ?? targetUser?.name ?? args.userId,
      undefined,
      { userId: args.userId, role },
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

    const member = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
      }),
    );
    if (!member?.organizationId) {
      throw new Error('Member not found');
    }

    const callerMember = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'organizationId', value: member.organizationId, operator: 'eq' },
          { field: 'userId', value: String(authUser._id), operator: 'eq' },
        ],
      }),
    );
    if (callerMember?.role?.toLowerCase() !== 'admin') {
      throw new Error('Only Admins can remove members');
    }

    const targetUser = member.userId
      ? findOneUser(
          await ctx.runQuery(components.betterAuth.adapter.findMany, {
            model: 'user',
            paginationOpts: { cursor: null, numItems: 1 },
            where: [{ field: '_id', value: member.userId, operator: 'eq' }],
          }),
        )
      : undefined;

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
      targetUser?.email ?? member.userId,
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

    const member = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
      }),
    );
    if (!member?.organizationId) {
      throw new Error('Member not found');
    }

    const callerMember = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'organizationId', value: member.organizationId, operator: 'eq' },
          { field: 'userId', value: String(authUser._id), operator: 'eq' },
        ],
      }),
    );
    if (callerMember?.role?.toLowerCase() !== 'admin') {
      throw new Error('Only Admins can update member roles');
    }

    const targetUser = member.userId
      ? findOneUser(
          await ctx.runQuery(components.betterAuth.adapter.findMany, {
            model: 'user',
            paginationOpts: { cursor: null, numItems: 1 },
            where: [{ field: '_id', value: member.userId, operator: 'eq' }],
          }),
        )
      : undefined;

    const previousRole = member.role;
    const newRole = args.role.toLowerCase();

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'member',
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
      targetUser?.email ?? member.userId,
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

    const member = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
      }),
    );
    if (!member?.userId || !member.organizationId) {
      throw new Error('Member not found');
    }

    const targetUser = findOneUser(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: '_id', value: member.userId, operator: 'eq' }],
      }),
    );
    const previousName = targetUser?.name;

    let callerRole: string | undefined;
    const isOwnProfile = String(authUser._id) === member.userId;
    if (!isOwnProfile) {
      const callerMember = findOneMember(
        await ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: 'member',
          paginationOpts: { cursor: null, numItems: 1 },
          where: [
            { field: 'organizationId', value: member.organizationId, operator: 'eq' },
            { field: 'userId', value: String(authUser._id), operator: 'eq' },
          ],
        }),
      );
      callerRole = callerMember?.role;
      if (callerMember?.role?.toLowerCase() !== 'admin') {
        throw new Error('Only Admins can update other members names');
      }
    }

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'user',
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

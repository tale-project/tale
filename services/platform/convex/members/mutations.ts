import { ConvexError, v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-utils';
import { components } from '../_generated/api';
import { mutation } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { assertNotHeld } from '../governance/legal_hold_guard';
import { cascadeOnMemberRemoved } from '../lib/cascades/personalization_cascade';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import {
  upsertMemberMirror,
  deleteMemberMirrorByMemberId,
} from './mirror_sync';
import type {
  BetterAuthMember,
  BetterAuthUser,
  BetterAuthCreateResult,
  BetterAuthFindManyResult,
} from './types';
import { memberRoleValidator } from './validators';

function findOneMember(
  res: BetterAuthFindManyResult<BetterAuthMember> | undefined,
) {
  return res?.page?.[0];
}

function findOneUser(
  res: BetterAuthFindManyResult<BetterAuthUser> | undefined,
) {
  return res?.page?.[0];
}

function isBetterAuthCreateResult(
  value: unknown,
): value is BetterAuthCreateResult {
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const callerMember = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
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
      }),
    );
    if (!isAdmin(callerMember?.role)) {
      throw new Error('Only admins can add members');
    }

    // The owner role can only be assigned through the owner-gated
    // transferOwnership flow — reject it here so a non-owner admin cannot
    // self-escalate by passing role: 'owner' (mirrors updateMemberRole).
    const role = (args.role ?? 'member').toLowerCase();
    if (role === 'owner') {
      throw new Error('The owner role cannot be assigned manually');
    }

    const targetUser = findOneUser(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: '_id', value: args.userId, operator: 'eq' }],
      }),
    );

    // Reject re-adding a user who already has a membership in this org, mirroring
    // createMember's existing-user branch. Without this, an admin could mint a
    // second membership row for an existing member (including themselves),
    // producing a duplicate mirror row regardless of role.
    const existingMember = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
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
      }),
    );
    if (existingMember) {
      throw new Error('User is already a member of this organization');
    }

    const createdAt = Date.now();
    const created = await ctx.runMutation(
      components.betterAuth.adapter.create,
      {
        input: {
          model: 'member',
          data: {
            organizationId: args.organizationId,
            userId: args.userId,
            role,
            createdAt,
          },
        },
      },
    );

    const memberId = String(
      isBetterAuthCreateResult(created) ? created._id : created,
    );

    // Keep the RLS read cache in step with the new membership.
    await upsertMemberMirror(ctx, {
      memberId,
      userId: args.userId,
      organizationId: args.organizationId,
      role,
      createdAt,
    });

    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: args.organizationId,
        actor: {
          id: authUser.userId,
          email: authUser.email,
          role: callerMember?.role,
          type: 'user',
        },
      },
      action: 'add_member',
      category: 'member',
      resourceType: 'member',
      resourceId: memberId,
      resourceName: targetUser?.email ?? targetUser?.name ?? args.userId,
      newState: { userId: args.userId, role },
    });

    return memberId;
  },
});

export const removeMember = mutation({
  args: {
    memberId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    const member = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
      }),
    );
    if (!member?.organizationId) {
      throw new ConvexError({ code: 'MEMBER_NOT_FOUND' });
    }

    const callerMember = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          {
            field: 'organizationId',
            value: member.organizationId,
            operator: 'eq',
          },
          { field: 'userId', value: authUser.userId, operator: 'eq' },
        ],
      }),
    );
    if (!isAdmin(callerMember?.role)) {
      throw new ConvexError({ code: 'MEMBER_REMOVE_FORBIDDEN' });
    }

    if (member.role?.toLowerCase() === 'owner') {
      throw new ConvexError({ code: 'MEMBER_OWNER_REMOVAL_FORBIDDEN' });
    }

    // Defense in depth for the UI bulk-select gate: an admin cannot remove
    // their own membership. Self-removal is a self-lockout that also fires
    // `cascadeOnMemberRemoved`, irreversibly wiping the caller's own
    // userPreferences for the org. Enforce server-side regardless of how
    // the request is issued.
    if (member.userId === authUser.userId) {
      throw new Error('You cannot remove your own membership');
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

    // Round-2 V4 P0-11: removing a member cascades into
    // `cascadeOnMemberRemoved`, which hard-deletes the user's
    // userPreferences scoped to this org. Refuse if the org is on a hold OR
    // if the member's userId is on a userMembership custodian hold —
    // without this gate, an admin could silently wipe a held custodian's
    // footprint.
    if (member.userId) {
      await assertNotHeld(
        ctx,
        member.organizationId,
        'userMembership',
        member.userId,
        undefined,
        member.userId,
      );
    }

    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: 'member',
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
      },
    });

    // Drop the mirror row so RLS stops granting access immediately.
    await deleteMemberMirrorByMemberId(ctx, args.memberId);

    if (member.userId) {
      await cascadeOnMemberRemoved(ctx, member.userId, member.organizationId);
    }

    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: member.organizationId,
        actor: {
          id: authUser.userId,
          email: authUser.email,
          role: callerMember?.role,
          type: 'user',
        },
      },
      action: 'remove_member',
      category: 'member',
      resourceType: 'member',
      resourceId: args.memberId,
      resourceName: targetUser?.email ?? member.userId,
      previousState: { userId: member.userId, role: member.role },
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    const member = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
      }),
    );
    if (!member?.organizationId) {
      throw new ConvexError({ code: 'MEMBER_NOT_FOUND' });
    }

    const callerMember = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          {
            field: 'organizationId',
            value: member.organizationId,
            operator: 'eq',
          },
          { field: 'userId', value: authUser.userId, operator: 'eq' },
        ],
      }),
    );
    if (!isAdmin(callerMember?.role)) {
      throw new ConvexError({ code: 'MEMBER_ROLE_UPDATE_FORBIDDEN' });
    }

    if (member.role?.toLowerCase() === 'owner') {
      throw new ConvexError({ code: 'MEMBER_OWNER_ROLE_IMMUTABLE' });
    }

    if (args.role.toLowerCase() === 'owner') {
      throw new ConvexError({ code: 'MEMBER_OWNER_ROLE_ASSIGN_FORBIDDEN' });
    }

    const orgResult = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'organization',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          {
            field: '_id',
            value: member.organizationId,
            operator: 'eq',
          },
        ],
      },
    );
    const orgRaw = orgResult?.page?.[0];
    if (isRecord(orgRaw)) {
      const rawMetadata = getString(orgRaw, 'metadata');
      if (rawMetadata) {
        let creatorId: unknown;
        try {
          const parsed: unknown = JSON.parse(rawMetadata);
          if (isRecord(parsed)) creatorId = parsed.creatorId;
        } catch (e) {
          // Malformed metadata can't pin a creator; log and skip the guard.
          console.warn('Failed to parse organization metadata', e);
        }
        if (creatorId === member.userId) {
          throw new ConvexError({ code: 'MEMBER_CREATOR_ROLE_IMMUTABLE' });
        }
      }
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

    if (isAdmin(previousRole) && !isAdmin(newRole)) {
      const adminMembers = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'member',
          paginationOpts: { cursor: null, numItems: 100 },
          where: [
            {
              field: 'organizationId',
              value: member.organizationId,
              operator: 'eq',
            },
          ],
        },
      );
      const adminCount = (adminMembers?.page ?? []).filter(
        (m: { role?: string }) => isAdmin(m.role),
      ).length;
      if (adminCount <= 1) {
        throw new ConvexError({ code: 'MEMBER_LAST_ADMIN' });
      }
    }

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'member',
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
        update: { role: newRole },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });

    // Reflect the new role in the RLS read cache.
    await upsertMemberMirror(ctx, {
      memberId: args.memberId,
      userId: member.userId,
      organizationId: member.organizationId,
      role: newRole,
      createdAt: member.createdAt,
    });

    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: member.organizationId,
        actor: {
          id: authUser.userId,
          email: authUser.email,
          role: callerMember?.role,
          type: 'user',
        },
      },
      action: 'update_member_role',
      category: 'member',
      resourceType: 'member',
      resourceId: args.memberId,
      resourceName: targetUser?.email ?? member.userId,
      previousState: { role: previousRole },
      newState: { role: newRole },
    });

    return null;
  },
});

export const transferOwnership = mutation({
  args: {
    targetMemberId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    const targetMember = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: '_id', value: args.targetMemberId, operator: 'eq' }],
      }),
    );
    if (!targetMember?.organizationId) {
      throw new ConvexError({ code: 'MEMBER_NOT_FOUND' });
    }

    const callerMember = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          {
            field: 'organizationId',
            value: targetMember.organizationId,
            operator: 'eq',
          },
          { field: 'userId', value: authUser.userId, operator: 'eq' },
        ],
      }),
    );
    if (callerMember?.role?.toLowerCase() !== 'owner') {
      throw new ConvexError({ code: 'OWNERSHIP_TRANSFER_FORBIDDEN' });
    }

    if (targetMember.role?.toLowerCase() === 'owner') {
      throw new ConvexError({ code: 'MEMBER_ALREADY_OWNER' });
    }

    // Promote target to owner
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'member',
        where: [{ field: '_id', value: args.targetMemberId, operator: 'eq' }],
        update: { role: 'owner' },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });

    // Demote caller to admin
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'member',
        where: [{ field: '_id', value: callerMember._id, operator: 'eq' }],
        update: { role: 'admin' },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });

    // Mirror the atomic owner swap.
    await upsertMemberMirror(ctx, {
      memberId: args.targetMemberId,
      userId: targetMember.userId,
      organizationId: targetMember.organizationId,
      role: 'owner',
      createdAt: targetMember.createdAt,
    });
    await upsertMemberMirror(ctx, {
      memberId: callerMember._id,
      userId: callerMember.userId,
      organizationId: callerMember.organizationId,
      role: 'admin',
      createdAt: callerMember.createdAt,
    });

    const targetUser = targetMember.userId
      ? findOneUser(
          await ctx.runQuery(components.betterAuth.adapter.findMany, {
            model: 'user',
            paginationOpts: { cursor: null, numItems: 1 },
            where: [
              { field: '_id', value: targetMember.userId, operator: 'eq' },
            ],
          }),
        )
      : undefined;

    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: targetMember.organizationId,
        actor: {
          id: authUser.userId,
          email: authUser.email,
          role: 'owner',
          type: 'user',
        },
      },
      action: 'transfer_ownership',
      category: 'member',
      resourceType: 'member',
      resourceId: args.targetMemberId,
      resourceName: targetUser?.email ?? targetMember.userId,
      previousState: { previousOwner: authUser.userId },
      newState: { newOwner: targetMember.userId },
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    const member = findOneMember(
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: '_id', value: args.memberId, operator: 'eq' }],
      }),
    );
    if (!member?.userId || !member.organizationId) {
      throw new ConvexError({ code: 'MEMBER_NOT_FOUND' });
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
    const isOwnProfile = authUser.userId === member.userId;
    if (!isOwnProfile) {
      const callerMember = findOneMember(
        await ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: 'member',
          paginationOpts: { cursor: null, numItems: 1 },
          where: [
            {
              field: 'organizationId',
              value: member.organizationId,
              operator: 'eq',
            },
            { field: 'userId', value: authUser.userId, operator: 'eq' },
          ],
        }),
      );
      callerRole = callerMember?.role;
      if (!isAdmin(callerMember?.role)) {
        throw new ConvexError({ code: 'MEMBER_NAME_UPDATE_FORBIDDEN' });
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

    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: member.organizationId,
        actor: {
          id: authUser.userId,
          email: authUser.email,
          role: callerRole,
          type: 'user',
        },
      },
      action: 'update_member_name',
      category: 'member',
      resourceType: 'member',
      resourceId: args.memberId,
      resourceName: targetUser?.email ?? member.userId,
      previousState: { name: previousName },
      newState: { name: args.displayName },
    });

    return null;
  },
});

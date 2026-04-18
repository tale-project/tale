/**
 * Admin-facing mutations for the 2FA feature. User-initiated enrollment
 * / disable / backup-code flows go through better-auth endpoints and are
 * instrumented via the after-hooks in `auth_hooks.ts`.
 */

import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { components, internal } from '../_generated/api';
import { mutation, type MutationCtx } from '../_generated/server';
import { authComponent } from '../auth';
import { isAdmin } from '../lib/rls/helpers/role_helpers';

interface MemberRecord {
  memberId: string;
  organizationId: string;
  userId: string;
  role: string | undefined;
}

async function findMember(
  ctx: MutationCtx,
  memberId: string,
): Promise<MemberRecord | null> {
  const res = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [{ field: '_id', value: memberId, operator: 'eq' }],
  });
  const raw = res?.page?.[0];
  if (!isRecord(raw)) return null;
  const organizationId = getString(raw, 'organizationId');
  const userId = getString(raw, 'userId');
  if (!organizationId || !userId) return null;
  return {
    memberId,
    organizationId,
    userId,
    role: getString(raw, 'role')?.toLowerCase(),
  };
}

async function findCallerMembership(
  ctx: MutationCtx,
  organizationId: string,
  callerUserId: string,
): Promise<{ role: string | undefined } | null> {
  const res = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [
      { field: 'organizationId', value: organizationId, operator: 'eq' },
      { field: 'userId', value: callerUserId, operator: 'eq' },
    ],
  });
  const raw = res?.page?.[0];
  if (!isRecord(raw)) return null;
  return { role: getString(raw, 'role')?.toLowerCase() };
}

/**
 * Delete every session for a user. Forces them to re-authenticate — used
 * after 2FA reset so a compromised user can't continue under a stale
 * session. Same pattern as `set_member_password.ts`.
 */
async function invalidateAllSessions(
  ctx: MutationCtx,
  userId: string,
): Promise<void> {
  const SESSION_BATCH_SIZE = 100;
  let hasMoreSessions = true;
  while (hasMoreSessions) {
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: {
        model: 'session',
        where: [{ field: 'userId', value: userId, operator: 'eq' }],
      },
      paginationOpts: { cursor: null, numItems: SESSION_BATCH_SIZE },
    });
    const remaining = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'session',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [{ field: 'userId', value: userId, operator: 'eq' }],
      },
    );
    hasMoreSessions = (remaining?.page?.length ?? 0) > 0;
  }
}

/**
 * Admin-triggered 2FA reset (issue #1507 §9). Deletes the target user's
 * `twoFactor` row, clears `user.twoFactorEnabled` and
 * `user.twoFactorGraceUntil`, kills all of their sessions, and emits an
 * audit-log entry keyed on both the admin and the target.
 *
 * Authorization: caller must be `owner` or `admin` in the SAME org as
 * the target member (lookup-then-check pattern from set_member_password).
 * Owner-to-owner reset is rejected unless the caller is a different
 * owner — prevents hostile self-takeover.
 *
 * This mutation is self-service: no admin password re-prompt. The
 * confirmation happens in the UI (AlertDialog). Protecting admin
 * sessions themselves is orthogonal (handled by session lifetime +
 * lockout on the admin's own account).
 */
export const resetForUser = mutation({
  args: {
    memberId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const member = await findMember(ctx, args.memberId);
    if (!member) throw new Error('Member not found');

    const callerMembership = await findCallerMembership(
      ctx,
      member.organizationId,
      String(authUser._id),
    );
    if (!callerMembership || !isAdmin(callerMembership.role)) {
      throw new Error('Only admins can reset two-factor for members');
    }

    // Owner-to-owner reset: allowed only when the caller is a *different*
    // owner. Self-reset goes through the account settings path.
    if (
      member.role === 'owner' &&
      (callerMembership.role !== 'owner' ||
        String(authUser._id) === member.userId)
    ) {
      throw new Error('Cannot reset two-factor for this member');
    }

    // Clear the twoFactor row if one exists.
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: {
        model: 'twoFactor',
        where: [{ field: 'userId', value: member.userId, operator: 'eq' }],
      },
      paginationOpts: { cursor: null, numItems: 10 },
    });

    // Flip twoFactorEnabled off + clear grace column so the user gets a
    // fresh window on their next sign-in.
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'user',
        where: [{ field: '_id', value: member.userId, operator: 'eq' }],
        update: {
          twoFactorEnabled: false,
          twoFactorGraceUntil: null,
        },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });

    // Drop any residual lockout counter — the target is getting a clean
    // slate to enrol fresh.
    const lockoutRow = await ctx.db
      .query('twoFactorAttempts')
      .withIndex('by_userId', (q) => q.eq('userId', member.userId))
      .first();
    if (lockoutRow) await ctx.db.delete(lockoutRow._id);

    await invalidateAllSessions(ctx, member.userId);

    await ctx.runMutation(
      internal.two_factor.internal_mutations.logEnrollmentEvent,
      {
        userId: member.userId,
        actorId: String(authUser._id),
        actorEmail: authUser.email,
        action: '2fa_reset_by_admin',
        metadata: { memberId: args.memberId },
      },
    );

    return null;
  },
});

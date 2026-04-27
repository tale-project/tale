import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { evaluateTwoFactorEnforcement } from './helpers';

/**
 * Read the current lockout state for a userId on TOTP / backup-code
 * verification. Parallel to `login_attempts.getLockState` (which is
 * email-keyed) — 2FA requests don't carry email in the body, they carry
 * a 2FA verification cookie that resolves to a userId.
 */
export const getLockStateByUserId = internalQuery({
  args: { userId: v.string() },
  returns: v.object({ lockedUntil: v.union(v.number(), v.null()) }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('twoFactorAttempts')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();
    return { lockedUntil: row?.lockedUntil ?? null };
  },
});

/**
 * Resolve the enforcement decision ('ok' | 'grace' | 'blocked') for a
 * given user + state snapshot. Lives as a query so the auth after-hook
 * (which runs in a runMutationCtx) can invoke it via `runQuery`.
 */
export const evaluateEnforcement = internalQuery({
  args: {
    userId: v.string(),
    twoFactorEnabled: v.boolean(),
    twoFactorGraceUntil: v.union(v.number(), v.null()),
  },
  returns: v.object({
    decision: v.union(
      v.literal('ok'),
      v.literal('grace'),
      v.literal('blocked'),
    ),
    graceUntilToSet: v.union(v.number(), v.null()),
    graceDeadline: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const result = await evaluateTwoFactorEnforcement(ctx, args);
    return {
      decision: result.decision,
      graceUntilToSet: result.graceUntilToSet,
      graceDeadline: result.graceDeadline,
    };
  },
});

import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import {
  computeLockedUntil,
  DEFAULT_LOGIN_POLICY,
  parseLoginPolicy,
  selectStrictestPolicy,
} from '../login_attempts/helpers';

interface MemberRow {
  organizationId: string;
}

async function findUserById(
  ctx: MutationCtx,
  userId: string,
): Promise<{ userId: string; email: string | null } | null> {
  const res = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'user',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [{ field: '_id', value: userId, operator: 'eq' }],
  });
  const raw = res?.page?.[0];
  if (!isRecord(raw)) return null;
  const id = getString(raw, '_id') ?? getString(raw, 'id');
  if (!id) return null;
  return { userId: id, email: getString(raw, 'email') ?? null };
}

async function findMemberOrgs(
  ctx: MutationCtx,
  userId: string,
): Promise<MemberRow[]> {
  const res = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 200 },
    where: [{ field: 'userId', value: userId, operator: 'eq' }],
  });
  const out: MemberRow[] = [];
  for (const row of res?.page ?? []) {
    if (!isRecord(row)) continue;
    const orgId = getString(row, 'organizationId');
    if (orgId) out.push({ organizationId: orgId });
  }
  return out;
}

/**
 * Record a failed TOTP / backup-code verification for `userId`. Reuses
 * the login-policy backoff schedule — a failed TOTP is the same severity
 * as a failed password in brute-force terms.
 */
export const recordFailure = internalMutation({
  args: {
    userId: v.string(),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    // 'totp' | 'backup_code' — drives the audit action name.
    method: v.union(v.literal('totp'), v.literal('backup_code')),
  },
  returns: v.object({
    locked: v.boolean(),
    lockedUntil: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const user = await findUserById(ctx, args.userId);
    if (!user) return { locked: false, lockedUntil: null };

    const orgs = await findMemberOrgs(ctx, user.userId);

    let policy = DEFAULT_LOGIN_POLICY;
    if (orgs.length > 0) {
      const policies = await Promise.all(
        orgs.map(async ({ organizationId }) => {
          const row = await ctx.db
            .query('governancePolicies')
            .withIndex('by_org_policyType', (q) =>
              q
                .eq('organizationId', organizationId)
                .eq('policyType', 'login_policy'),
            )
            .first();
          return parseLoginPolicy(row?.config);
        }),
      );
      policy = selectStrictestPolicy(policies);
    }

    if (!policy.enabled) {
      return { locked: false, lockedUntil: null };
    }

    const now = Date.now();
    const existing = await ctx.db
      .query('twoFactorAttempts')
      .withIndex('by_userId', (q) => q.eq('userId', user.userId))
      .first();

    const previousFailures = existing?.consecutiveFailures ?? 0;
    const newFailures = previousFailures + 1;
    const lockedUntil = computeLockedUntil(newFailures, now, policy);

    if (existing) {
      await ctx.db.patch(existing._id, {
        consecutiveFailures: newFailures,
        lastFailureAt: now,
        lockedUntil,
      });
    } else {
      await ctx.db.insert('twoFactorAttempts', {
        userId: user.userId,
        consecutiveFailures: newFailures,
        lastFailureAt: now,
        lockedUntil,
      });
    }

    const action =
      args.method === 'backup_code'
        ? '2fa_backup_code_failed'
        : '2fa_verify_failed';
    for (const { organizationId } of orgs) {
      await createAuditLog(ctx, {
        organizationId,
        actorId: user.userId,
        actorEmail: user.email ?? undefined,
        actorType: 'user',
        action,
        category: 'security',
        resourceType: 'twoFactorAuth',
        resourceId: user.userId,
        ipAddress: args.ip,
        userAgent: args.userAgent,
        status: 'failure',
        errorMessage: 'Invalid two-factor code',
        metadata: {
          consecutiveFailures: newFailures,
          ...(lockedUntil !== null
            ? { lockedUntil: new Date(lockedUntil).toISOString() }
            : {}),
        },
      });
    }

    return { locked: lockedUntil !== null, lockedUntil };
  },
});

/** Clear the 2FA attempt counter on a successful verify. */
export const clearOnSuccess = internalMutation({
  args: {
    userId: v.string(),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    method: v.union(v.literal('totp'), v.literal('backup_code')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('twoFactorAttempts')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();
    if (row) await ctx.db.delete(row._id);

    const user = await findUserById(ctx, args.userId);
    if (!user) return null;

    const orgs = await findMemberOrgs(ctx, user.userId);
    const action =
      args.method === 'backup_code' ? '2fa_backup_code_used' : '2fa_verified';
    for (const { organizationId } of orgs) {
      await createAuditLog(ctx, {
        organizationId,
        actorId: user.userId,
        actorEmail: user.email ?? undefined,
        actorType: 'user',
        action,
        category: 'security',
        resourceType: 'twoFactorAuth',
        resourceId: user.userId,
        ipAddress: args.ip,
        userAgent: args.userAgent,
        status: 'success',
      });
    }
    return null;
  },
});

/**
 * Persist `user.twoFactorGraceUntil` idempotently. Called from the
 * enforcement after-hook on the first sign-in where enforcement applies
 * to this user and the column is still null. Never overwrites an
 * existing value — the whole point is per-user stability across policy
 * edits.
 */
export const setGraceUntilIfAbsent = internalMutation({
  args: {
    userId: v.string(),
    graceUntil: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const res = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: args.userId, operator: 'eq' }],
    });
    const row = res?.page?.[0];
    if (!isRecord(row)) return null;
    const existing = row.twoFactorGraceUntil;
    if (typeof existing === 'number') return null;

    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'user' as const,
        where: [{ field: '_id', value: args.userId, operator: 'eq' }],
        update: { twoFactorGraceUntil: args.graceUntil },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });
    return null;
  },
});

/**
 * Emit an audit log entry for an enrollment event (2fa_enrolled /
 * 2fa_disabled / 2fa_reset_by_admin). Org-scoped: one row per org the
 * target user belongs to, same as login_attempts events.
 */
export const logEnrollmentEvent = internalMutation({
  args: {
    userId: v.string(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
    action: v.union(
      v.literal('2fa_enrolled'),
      v.literal('2fa_disabled'),
      v.literal('2fa_reset_by_admin'),
    ),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const orgs = await findMemberOrgs(ctx, args.userId);
    for (const { organizationId } of orgs) {
      await createAuditLog(ctx, {
        organizationId,
        actorId: args.actorId,
        actorEmail: args.actorEmail,
        actorType: 'user',
        action: args.action,
        category: 'security',
        resourceType: 'twoFactorAuth',
        resourceId: args.userId,
        ipAddress: args.ip,
        userAgent: args.userAgent,
        status: 'success',
        metadata: args.metadata,
      });
    }
    return null;
  },
});

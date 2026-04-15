import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { writeNotificationForOrgs } from '../notifications/helpers';
import {
  computeLockedUntil,
  DEFAULT_LOGIN_POLICY,
  parseLoginPolicy,
  selectStrictestPolicy,
} from './helpers';

interface MemberRow {
  organizationId: string;
}

async function findUserByEmail(
  ctx: MutationCtx,
  email: string,
): Promise<{ userId: string } | null> {
  const res = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'user',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [{ field: 'email', value: email, operator: 'eq' }],
  });
  const raw = res?.page?.[0];
  if (!isRecord(raw)) return null;
  const id = getString(raw, '_id') ?? getString(raw, 'id');
  return id ? { userId: id } : null;
}

async function findMemberOrgs(
  ctx: MutationCtx,
  userId: string,
): Promise<MemberRow[]> {
  // Single page is plenty — a real user belongs to a handful of orgs at most.
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
 * Record a failed sign-in attempt for `email`. Atomically reads + patches
 * the loginAttempts row. Looks up the strictest applicable login policy
 * across the user's org memberships and computes lockedUntil.
 *
 * For unknown emails (no user row) this is a no-op — see the enumeration
 * mitigation in /home/larry/.claude/plans/foamy-kindling-papert.md.
 */
export const recordFailure = internalMutation({
  args: {
    email: v.string(),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  returns: v.object({
    locked: v.boolean(),
    lockedUntil: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const email = args.email.toLowerCase();
    const user = await findUserByEmail(ctx, email);
    if (!user) {
      // Unknown email — do not write any row. Avoids enumeration leak via
      // 429-vs-401 differential and prevents DoS-amplification by random
      // email spam.
      return { locked: false, lockedUntil: null };
    }

    const orgs = await findMemberOrgs(ctx, user.userId);

    // Resolve effective policy: strictest across user's orgs, defaults if none.
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
      .query('loginAttempts')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first();

    const previousFailures = existing?.consecutiveFailures ?? 0;
    const previouslyLocked =
      previousFailures >= policy.maxAttemptsBeforeLockout;

    const newFailures = previousFailures + 1;
    const lockedUntil = computeLockedUntil(newFailures, now, policy);
    const newlyLocked =
      !previouslyLocked && newFailures >= policy.maxAttemptsBeforeLockout;

    if (existing) {
      await ctx.db.patch(existing._id, {
        consecutiveFailures: newFailures,
        lastFailureAt: now,
        lockedUntil,
      });
    } else {
      await ctx.db.insert('loginAttempts', {
        email,
        consecutiveFailures: newFailures,
        lastFailureAt: now,
        lockedUntil,
      });
    }

    // Audit logs are org-scoped, so we write one per org the user belongs to.
    for (const { organizationId } of orgs) {
      await createAuditLog(ctx, {
        organizationId,
        actorId: user.userId,
        actorEmail: email,
        actorType: 'user',
        action: 'login_attempt',
        category: 'security',
        resourceType: 'user',
        resourceId: user.userId,
        ipAddress: args.ip,
        userAgent: args.userAgent,
        status: 'failure',
        errorMessage: 'Invalid credentials',
        metadata: {
          consecutiveFailures: newFailures,
          // Surface the lock state on every failed attempt so the audit
          // trail explains the UI timer — a lockout extension doesn't emit
          // a separate `login_lockout` row (that fires only on the first
          // threshold crossing).
          ...(lockedUntil !== null
            ? { lockedUntil: new Date(lockedUntil).toISOString() }
            : {}),
        },
      });

      if (newlyLocked) {
        await createAuditLog(ctx, {
          organizationId,
          actorId: user.userId,
          actorEmail: email,
          actorType: 'system',
          action: 'login_lockout',
          category: 'security',
          resourceType: 'user',
          resourceId: user.userId,
          ipAddress: args.ip,
          userAgent: args.userAgent,
          status: 'denied',
          errorMessage: 'Account temporarily locked due to repeated failures',
          // Store lockedUntil as ISO string — the audit-log detail dialog
          // uses a generic JSON renderer and a raw epoch number is unreadable.
          metadata: {
            consecutiveFailures: newFailures,
            lockedUntil:
              lockedUntil !== null ? new Date(lockedUntil).toISOString() : null,
          },
        });
      }
    }

    if (newlyLocked && orgs.length > 0) {
      await writeNotificationForOrgs(ctx, {
        organizationIds: orgs.map((o) => o.organizationId),
        category: 'security',
        severity: 'warning',
        // Keys are resolved against the `notifications` i18n namespace on the
        // client (see NotificationBell's useT('notifications') binding), so
        // we do NOT include the namespace prefix in storage.
        titleKey: 'accountLocked',
        bodyKey: 'lockoutDetails',
        params: {
          email,
          ip: args.ip ?? 'unknown',
          consecutiveFailures: newFailures,
        },
      });
    }

    return { locked: lockedUntil !== null, lockedUntil };
  },
});

const HOUR_MS = 3_600_000;

/**
 * Record a sign-in attempt that the before-hook rejected (either per-IP
 * flood guard or account lockout). Coalesces into an hourly counter row
 * in `loginBlockCounters` — see the table comment in schema.ts for the
 * rationale. Does NOT touch the failure counter / `lockedUntil`, since
 * the password check never ran.
 *
 * Only records for known emails; unknown emails are silently dropped to
 * avoid unbounded row growth from random-email attacks.
 */
export const recordBlocked = internalMutation({
  args: {
    email: v.string(),
    ip: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = args.email.toLowerCase();
    const user = await findUserByEmail(ctx, email);
    if (!user) return null;

    const row = await ctx.db
      .query('loginAttempts')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first();
    const lockedActive =
      row?.lockedUntil != null && row.lockedUntil > Date.now();

    const now = Date.now();
    const windowStart = Math.floor(now / HOUR_MS) * HOUR_MS;

    const existing = await ctx.db
      .query('loginBlockCounters')
      .withIndex('by_email_window', (q) =>
        q.eq('email', email).eq('windowStart', windowStart),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lockoutCount: existing.lockoutCount + (lockedActive ? 1 : 0),
        ipLimitCount: existing.ipLimitCount + (lockedActive ? 0 : 1),
        lastIp: args.ip ?? existing.lastIp,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('loginBlockCounters', {
        email,
        windowStart,
        lockoutCount: lockedActive ? 1 : 0,
        ipLimitCount: lockedActive ? 0 : 1,
        lastIp: args.ip,
        updatedAt: now,
      });
    }
    return null;
  },
});

/**
 * Clear failure state on successful sign-in. Cleanup-on-success keeps the
 * table small without needing a periodic cron in v1.
 */
export const clearOnSuccess = internalMutation({
  args: {
    email: v.string(),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = args.email.toLowerCase();
    const row = await ctx.db
      .query('loginAttempts')
      .withIndex('by_email', (q) => q.eq('email', email))
      .first();
    if (row) await ctx.db.delete(row._id);

    // NIST SP 800-92 and SOC 2 both require successful authentications to
    // be logged alongside failures. Success is low-volume so there's no
    // flood concern.
    const user = await findUserByEmail(ctx, email);
    if (!user) return null;

    const orgs = await findMemberOrgs(ctx, user.userId);
    for (const { organizationId } of orgs) {
      await createAuditLog(ctx, {
        organizationId,
        actorId: user.userId,
        actorEmail: email,
        actorType: 'user',
        action: 'login_success',
        category: 'security',
        resourceType: 'user',
        resourceId: user.userId,
        ipAddress: args.ip,
        userAgent: args.userAgent,
        status: 'success',
      });
    }
    return null;
  },
});

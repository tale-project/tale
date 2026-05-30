import { ConvexError, v } from 'convex/values';

import { internalMutation, internalQuery, query } from '../_generated/server';
import {
  RateLimitExceededError,
  checkIpRateLimit,
  checkOrganizationRateLimit,
} from '../lib/rate_limiter/helpers';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';

export const listAppPasswords = query({
  args: {
    organizationId: v.string(),
  },
  async handler(ctx, args) {
    const authUser = await requireAuthenticatedUser(ctx);

    const rows = await ctx.db
      .query('webdavAppPasswords')
      .withIndex('by_organization_user', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', authUser.userId),
      )
      .collect();

    // Metadata only — never expose the hash.
    return rows.map((r) => ({
      _id: r._id,
      label: r.label,
      prefix: r.passwordPrefix,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      revokedAt: r.revokedAt,
    }));
  },
});

// Hono looks up the small set of candidate rows by prefix + org slug,
// then HMAC-compares the supplied password against each candidate's
// passwordHashed (constant-time). Returns the hash so the caller can do
// the compare — the prefix narrows to ~1 candidate per org.
//
// Read-only internalQuery: it consumes NO rate-limit token. Throttling is
// charged separately by `chargeWebdavAuthFailure`, and ONLY on a failed
// match — so a legitimate client (Finder/rclone) that fires many
// authenticated requests, all succeeding, never depletes the bucket. The
// old design charged a per-org token on every call (successes included),
// which 403'd whole orgs under normal mount load and let anyone who knew
// an org slug lock that org out.
export const findCandidatesByPrefix = internalQuery({
  args: {
    organizationId: v.string(),
    prefix: v.string(),
  },
  async handler(ctx, args) {
    if (args.prefix.length < 4) return [];
    const rows = await ctx.db
      .query('webdavAppPasswords')
      .withIndex('by_organization_prefix', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('passwordPrefix', args.prefix.slice(0, 4)),
      )
      .collect();
    return rows
      .filter((r) => r.revokedAt === undefined)
      .map((r) => ({
        _id: r._id,
        userId: r.userId,
        passwordHashed: r.passwordHashed,
      }));
  },
});

// Charge one failed WebDAV auth attempt against two token buckets:
//   - `webdav:auth-fail-ip`  — keyed by the client IP. The primary
//     brute-force throttle. Because it's keyed to the attacker's own IP,
//     a flood from one source can't deny service to a victim org.
//   - `webdav:auth-fail-org` — a high per-org backstop for distributed
//     probing of a known org slug; set high enough never to trip on
//     legitimate traffic (successes aren't charged at all).
// `organizationId` may be '' when the org slug didn't resolve (slug
// enumeration) — in that case only the per-IP bucket is charged.
// Throws ConvexError({ code: 'RATE_LIMITED' }) when a bucket is empty;
// the Hono auth path maps that to a 403.
export const chargeWebdavAuthFailure = internalMutation({
  args: {
    organizationId: v.string(),
    clientIp: v.string(),
  },
  async handler(ctx, args) {
    try {
      await checkIpRateLimit(ctx, 'webdav:auth-fail-ip', args.clientIp, 1);
      if (args.organizationId.length > 0) {
        await checkOrganizationRateLimit(
          ctx,
          'webdav:auth-fail-org',
          args.organizationId,
          1,
        );
      }
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        throw new ConvexError({ code: 'RATE_LIMITED' });
      }
      throw err;
    }
  },
});

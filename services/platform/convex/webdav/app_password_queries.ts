import { ConvexError, v } from 'convex/values';

import { internalMutation, query } from '../_generated/server';
import {
  RateLimitExceededError,
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
// Implemented as an internalMutation (not Query) so we can consume a
// `webdav:auth-attempt` rate-limit token per request — the limiter
// component requires write access. The lookup itself only reads rows;
// no row mutation happens on the auth path beyond the limiter's own
// counter writes. Each /dav/* dispatch hits this once and the limit
// caps brute-force probing per org.
export const findCandidatesByPrefix = internalMutation({
  args: {
    organizationId: v.string(),
    prefix: v.string(),
  },
  async handler(ctx, args) {
    // Consume one token BEFORE the lookup. If the bucket is exhausted
    // we throw a ConvexError({ code: 'RATE_LIMITED' }) — the Hono auth
    // path catches the underlying RateLimitExceededError and surfaces
    // it as a 429 on the wire. Don't silently fall through to the
    // lookup; that would defeat the whole point of the cap.
    try {
      await checkOrganizationRateLimit(
        ctx,
        'webdav:auth-attempt',
        args.organizationId,
        1,
      );
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        throw new ConvexError({ code: 'RATE_LIMITED' });
      }
      throw err;
    }

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

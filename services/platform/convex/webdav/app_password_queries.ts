import { v } from 'convex/values';

import { internalQuery, query } from '../_generated/server';
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

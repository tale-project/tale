import { ConvexError, v } from 'convex/values';

import { internalMutation, mutation } from '../_generated/server';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { getUserOrganizations } from '../lib/rls/organization/get_user_organizations';
import {
  generateAppPasswordSecret,
  hmacHash,
  requireHmacSecret,
} from './helpers';

export const createAppPassword = mutation({
  args: {
    organizationId: v.string(),
    label: v.string(),
  },
  async handler(ctx, args) {
    const authUser = await requireAuthenticatedUser(ctx);

    const orgs = await getUserOrganizations(ctx, authUser);
    if (!orgs.some((o) => o.organizationId === args.organizationId)) {
      throw new ConvexError({ code: 'FORBIDDEN' });
    }

    const label = args.label.trim();
    if (label.length === 0 || label.length > 64) {
      throw new ConvexError({ code: 'INVALID_LABEL' });
    }

    const secret = generateAppPasswordSecret();
    const passwordHashed = await hmacHash(secret, requireHmacSecret());
    const passwordPrefix = secret.slice(0, 4);

    await ctx.db.insert('webdavAppPasswords', {
      organizationId: args.organizationId,
      userId: authUser.userId,
      label,
      passwordHashed,
      passwordPrefix,
      createdAt: Date.now(),
    });

    // Return plaintext ONCE. Caller (UI) must surface and never read back.
    return { password: secret, prefix: passwordPrefix };
  },
});

export const revokeAppPassword = mutation({
  args: {
    id: v.id('webdavAppPasswords'),
  },
  async handler(ctx, args) {
    const authUser = await requireAuthenticatedUser(ctx);

    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== authUser.userId) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }
    if (row.revokedAt !== undefined) return; // Already revoked, idempotent.

    await ctx.db.patch(args.id, { revokedAt: Date.now() });

    // Hard-delete any live locks held under this app-password — protects
    // the "client crashed mid-edit, lock outlives session" recovery path
    // described in the plan. Lock TTL would eventually do this too but
    // explicit revoke is the documented force-release path.
    const locks = await ctx.db
      .query('webdavLocks')
      .withIndex('by_appPasswordId', (q) => q.eq('appPasswordId', args.id))
      .collect();
    for (const lock of locks) {
      await ctx.db.delete(lock._id);
    }
  },
});

// Hono server records use after a successful HMAC compare. Debounced to
// once-per-minute by the caller (server.ts) to avoid write storms on
// long-lived WebDAV mounts that issue many requests per second.
export const recordAppPasswordUse = internalMutation({
  args: {
    id: v.id('webdavAppPasswords'),
    at: v.number(),
  },
  async handler(ctx, args) {
    const row = await ctx.db.get(args.id);
    if (!row || row.revokedAt !== undefined) return;
    await ctx.db.patch(args.id, { lastUsedAt: args.at });
  },
});

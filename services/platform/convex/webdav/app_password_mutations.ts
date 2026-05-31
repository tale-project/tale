import { ConvexError, v } from 'convex/values';

import { internalMutation, mutation } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { checkOrganizationRateLimit } from '../lib/rate_limiter/helpers';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import {
  generateAppPasswordSecret,
  hmacHash,
  requireHmacSecret,
} from './helpers';

// Hard cap on active (non-revoked) app-passwords per (org, user). Mirrors
// the Better Auth API-key approach: a single user holding hundreds of
// live PAT-equivalent credentials is almost always a runaway script —
// 50 is generous for power users with many devices and tight enough
// that a compromised admin loop is bounded.
const MAX_ACTIVE_APP_PASSWORDS_PER_USER = 50;

export const createAppPassword = mutation({
  args: {
    organizationId: v.string(),
    label: v.string(),
  },
  async handler(ctx, args) {
    // App-passwords are PAT-equivalent (HTTP Basic auth bypassing Better
    // Auth session cookies). Gate creation on the `developerSettings`
    // capability so `member`/`editor` roles cannot mint credentials that
    // outlive their normal session scope. Mirrors the API-keys flow.
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    // Per-org mint-rate cap — AFTER the role gate so unauthenticated /
    // unauthorized callers can't drain the bucket on the org's behalf.
    // 20/hour is well above legitimate device-onboarding rates; a
    // runaway script trips it within minutes. RateLimitExceededError
    // bubbles up as a thrown Error to the UI mutation client.
    await checkOrganizationRateLimit(
      ctx,
      'webdav:app-password-create',
      args.organizationId,
      1,
    );

    // Per-(org, user) hard count cap on active rows. Mirrors Better
    // Auth's API-key count ceiling. Walks the by_organization_user
    // index and tallies non-revoked rows — cheap because the typical
    // user holds 1-5 credentials.
    const existing = await ctx.db
      .query('webdavAppPasswords')
      .withIndex('by_organization_user', (q) =>
        q.eq('organizationId', args.organizationId).eq('userId', auth.userId),
      )
      .collect();
    const activeCount = existing.filter(
      (r) => r.revokedAt === undefined,
    ).length;
    if (activeCount >= MAX_ACTIVE_APP_PASSWORDS_PER_USER) {
      throw new ConvexError({ code: 'LIMIT_EXCEEDED' });
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
      userId: auth.userId,
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
    // Revoke only requires authentication + ownership — a user revoking
    // their own credential after losing role privileges must still
    // succeed (otherwise compromised members can hold a live token
    // forever). The `userId === authUser.userId` check below is the
    // ownership gate.
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

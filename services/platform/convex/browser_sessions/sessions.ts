import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation, query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

// The public import ACTION lives in `./session_import` on purpose: an action
// that calls its own file's internalMutation via `internal.…` forms a
// self-referential api type that collapses the generated api types to `any`
// (the known Convex api-type poisoning). Keeping the action in a sibling file
// breaks the cycle. The TTL default it uses is re-exported below.

/** Default life of an imported session when the operator doesn't set one. */
export const DEFAULT_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** After this many consecutive bot-wall/forbidden failures a session is burned
 *  (expired) rather than merely cooled — it clearly no longer passes. */
const MAX_SESSION_FAILURES = 3;
/** Cooling sessions recover to healthy after this quiet period. */
const COOLING_RECOVERY_MS = 30 * 60 * 1000;
/** Expired rows are pruned this long after expiry so the list stays clean. */
const EXPIRED_PRUNE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Atomically claim the least-recently-used healthy, non-expired session for
 * `domain` — returns its ENCRYPTED cookies (+ UA / site extras) and stamps
 * `lastUsedAt` so concurrent reach-outs rotate through the pool instead of
 * hammering one session. The caller (a node action) decrypts. `null` when no
 * session for the domain is available — the reach-out then proceeds without one
 * (an env proxy / provider still applies).
 */
export const claimBrowserSession = internalMutation({
  args: { domain: v.string() },
  returns: v.union(
    v.object({
      sessionId: v.id('browserSessions'),
      cookiesEncrypted: v.string(),
      userAgent: v.optional(v.string()),
      visitorData: v.optional(v.string()),
      poToken: v.optional(v.string()),
    }),
    v.null(),
  ),
  async handler(ctx, args) {
    const now = Date.now();
    for await (const row of ctx.db
      .query('browserSessions')
      .withIndex('by_domain_and_status_and_lastUsedAt', (q) =>
        q.eq('domain', args.domain).eq('status', 'healthy'),
      )) {
      if (row.expiresAt <= now) continue; // stale; the cron will expire it
      await ctx.db.patch(row._id, { lastUsedAt: now });
      return {
        sessionId: row._id,
        cookiesEncrypted: row.cookiesEncrypted,
        ...(row.userAgent !== undefined && { userAgent: row.userAgent }),
        ...(row.visitorData !== undefined && { visitorData: row.visitorData }),
        ...(row.poToken !== undefined && { poToken: row.poToken }),
      };
    }
    return null;
  },
});

/**
 * Record the outcome of a reach-out that used a session. A bot-wall / forbidden
 * / rate-limit result increments the failure count and cools (or, past the
 * threshold, expires) the session so a burned one stops being handed out;
 * success resets the count. No-op if the row is gone.
 */
export const reportBrowserSessionResult = internalMutation({
  args: {
    sessionId: v.id('browserSessions'),
    outcome: v.union(v.literal('ok'), v.literal('blocked')),
  },
  returns: v.null(),
  async handler(ctx, args) {
    const row = await ctx.db.get(args.sessionId);
    if (!row) return null;
    if (args.outcome === 'ok') {
      if (row.failureCount) await ctx.db.patch(row._id, { failureCount: 0 });
      return null;
    }
    const failureCount = (row.failureCount ?? 0) + 1;
    await ctx.db.patch(row._id, {
      failureCount,
      status: failureCount >= MAX_SESSION_FAILURES ? 'expired' : 'cooling',
    });
    return null;
  },
});

/** Insert an encrypted session row (called by the import action). */
export const insertBrowserSession = internalMutation({
  args: {
    domain: v.string(),
    cookiesEncrypted: v.string(),
    userAgent: v.optional(v.string()),
    visitorData: v.optional(v.string()),
    poToken: v.optional(v.string()),
    label: v.optional(v.string()),
    expiresAt: v.number(),
    createdBy: v.optional(v.string()),
  },
  returns: v.id('browserSessions'),
  async handler(ctx, args) {
    return await ctx.db.insert('browserSessions', {
      domain: args.domain,
      cookiesEncrypted: args.cookiesEncrypted,
      ...(args.userAgent !== undefined && { userAgent: args.userAgent }),
      ...(args.visitorData !== undefined && { visitorData: args.visitorData }),
      ...(args.poToken !== undefined && { poToken: args.poToken }),
      ...(args.label !== undefined && { label: args.label }),
      status: 'healthy',
      source: 'imported',
      expiresAt: args.expiresAt,
      failureCount: 0,
      ...(args.createdBy !== undefined && { createdBy: args.createdBy }),
    });
  },
});

/**
 * Cron sweep: expire past-TTL sessions, recover cooled ones whose quiet period
 * elapsed, and prune long-expired rows. Keyed on `by_status` so it only visits
 * live rows across all domains.
 */
export const sweepBrowserSessions = internalMutation({
  args: {},
  returns: v.null(),
  async handler(ctx) {
    const now = Date.now();
    for await (const row of ctx.db
      .query('browserSessions')
      .withIndex('by_status', (q) => q.eq('status', 'healthy'))) {
      if (row.expiresAt <= now) {
        await ctx.db.patch(row._id, { status: 'expired' });
      }
    }
    for await (const row of ctx.db
      .query('browserSessions')
      .withIndex('by_status', (q) => q.eq('status', 'cooling'))) {
      if (row.expiresAt <= now) {
        await ctx.db.patch(row._id, { status: 'expired' });
      } else if ((row.lastUsedAt ?? 0) + COOLING_RECOVERY_MS < now) {
        await ctx.db.patch(row._id, { status: 'healthy', failureCount: 0 });
      }
    }
    for await (const row of ctx.db
      .query('browserSessions')
      .withIndex('by_status', (q) => q.eq('status', 'expired'))) {
      if (row.expiresAt + EXPIRED_PRUNE_MS < now) await ctx.db.delete(row._id);
    }
    return null;
  },
});

/**
 * Import a warmed browser session into the pool — the human-assisted path: an
 * operator solves the bot challenge in a real browser, exports the site's
 * cookie jar (Netscape format), and pastes it here with the target `domain`.
 * Deployment-operator gated (write). The jar is encrypted at rest and never
 * returned.
 */
/**
 * Masked list of pooled sessions for the operator UI — never the cookies. Any
 * authenticated user of the (typically single-org) deployment may view; the
 * import mutation is the gated write.
 */
export const listBrowserSessions = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('browserSessions'),
      domain: v.string(),
      label: v.optional(v.string()),
      status: v.string(),
      expiresAt: v.number(),
      lastUsedAt: v.optional(v.number()),
      failureCount: v.optional(v.number()),
    }),
  ),
  async handler(ctx) {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    const out: Array<{
      _id: Id<'browserSessions'>;
      domain: string;
      label?: string;
      status: string;
      expiresAt: number;
      lastUsedAt?: number;
      failureCount?: number;
    }> = [];
    for await (const row of ctx.db.query('browserSessions')) {
      out.push({
        _id: row._id,
        domain: row.domain,
        ...(row.label !== undefined && { label: row.label }),
        status: row.status,
        expiresAt: row.expiresAt,
        ...(row.lastUsedAt !== undefined && { lastUsedAt: row.lastUsedAt }),
        ...(row.failureCount !== undefined && {
          failureCount: row.failureCount,
        }),
      });
    }
    return out;
  },
});

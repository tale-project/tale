/**
 * Transactional lifecycle of a pending OAuth2 authorization.
 *
 * These are mutations rather than helpers because single-use is a concurrency
 * property, not a code-shape one: `consumePendingAuthorization` reads and
 * deletes the row inside ONE Convex transaction, so two callbacks replaying the
 * same state token cannot both observe it. A read-then-delete split across two
 * calls would let a replay slip through the gap.
 */

import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { OAUTH_STATE_TTL_MS } from './oauth_state';

/**
 * How many stale rows one mint may clear. Abandoned authorizations (the user
 * closed the consent screen) are never consumed, so something has to collect
 * them; doing it here keeps the table bounded without a cron, and the cap keeps
 * the mint's transaction small.
 */
const EXPIRED_SWEEP_LIMIT = 25;

/**
 * Record the authorization the browser is about to be redirected into, and
 * sweep a bounded page of expired rows while we hold the transaction.
 */
export const createPendingAuthorization = internalMutation({
  args: {
    stateHash: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    connectorSlug: v.string(),
    codeVerifier: v.string(),
    redirectUri: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();

    const expired = await ctx.db
      .query('connectorOauthStates')
      .withIndex('by_expires_at', (q) => q.lt('expiresAt', now))
      .take(EXPIRED_SWEEP_LIMIT);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }

    await ctx.db.insert('connectorOauthStates', {
      stateHash: args.stateHash,
      organizationId: args.organizationId,
      userId: args.userId,
      connectorSlug: args.connectorSlug,
      codeVerifier: args.codeVerifier,
      redirectUri: args.redirectUri,
      createdAt: now,
      expiresAt: now + OAUTH_STATE_TTL_MS,
    });
    return null;
  },
});

/**
 * Claim a pending authorization by its state hash: returns its bound context
 * and removes it, whatever the outcome. An expired row is deleted too — it can
 * never become valid again, and leaving it would let a caller keep probing the
 * same hash.
 */
export const consumePendingAuthorization = internalMutation({
  args: { stateHash: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      organizationId: v.string(),
      userId: v.string(),
      connectorSlug: v.string(),
      codeVerifier: v.string(),
      redirectUri: v.string(),
    }),
    v.object({
      ok: v.literal(false),
      // `unknown` covers a forged state, a state for another deployment, and a
      // replay of one already consumed — deliberately indistinguishable to the
      // caller, since telling them apart only helps an attacker.
      reason: v.union(v.literal('unknown'), v.literal('expired')),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('connectorOauthStates')
      .withIndex('by_state_hash', (q) => q.eq('stateHash', args.stateHash))
      .first();
    if (!row) return { ok: false as const, reason: 'unknown' as const };

    await ctx.db.delete(row._id);

    if (row.expiresAt <= Date.now()) {
      return { ok: false as const, reason: 'expired' as const };
    }
    return {
      ok: true as const,
      organizationId: row.organizationId,
      userId: row.userId,
      connectorSlug: row.connectorSlug,
      codeVerifier: row.codeVerifier,
      redirectUri: row.redirectUri,
    };
  },
});

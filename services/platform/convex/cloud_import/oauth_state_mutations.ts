/**
 * Transactional lifecycle of a pending cloud-import OAuth2 authorization.
 * Same single-use / hashed-state doctrine as connector OAuth states.
 */

import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { OAUTH_STATE_TTL_MS } from '../http_connectors/oauth_state';
import { cloudImportProviderValidator } from './schema';

const EXPIRED_SWEEP_LIMIT = 25;

export const createPendingAuthorization = internalMutation({
  args: {
    stateHash: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    provider: cloudImportProviderValidator,
    codeVerifier: v.string(),
    redirectUri: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();

    const expired = await ctx.db
      .query('cloudImportOauthStates')
      .withIndex('by_expires_at', (q) => q.lt('expiresAt', now))
      .take(EXPIRED_SWEEP_LIMIT);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }

    await ctx.db.insert('cloudImportOauthStates', {
      stateHash: args.stateHash,
      organizationId: args.organizationId,
      userId: args.userId,
      provider: args.provider,
      codeVerifier: args.codeVerifier,
      redirectUri: args.redirectUri,
      createdAt: now,
      expiresAt: now + OAUTH_STATE_TTL_MS,
    });
    return null;
  },
});

export const consumePendingAuthorization = internalMutation({
  args: { stateHash: v.string() },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      organizationId: v.string(),
      userId: v.string(),
      provider: cloudImportProviderValidator,
      codeVerifier: v.string(),
      redirectUri: v.string(),
    }),
    v.object({
      ok: v.literal(false),
      reason: v.union(v.literal('unknown'), v.literal('expired')),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('cloudImportOauthStates')
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
      provider: row.provider,
      codeVerifier: row.codeVerifier,
      redirectUri: row.redirectUri,
    };
  },
});

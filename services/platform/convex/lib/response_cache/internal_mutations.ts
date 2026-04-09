import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalMutation } from '../../_generated/server';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_BATCH_SIZE = 100;

export const storeCache = internalMutation({
  args: {
    cacheKey: v.string(),
    responseText: v.string(),
    model: v.string(),
    provider: v.optional(v.string()),
    usage: v.optional(
      v.object({
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        totalTokens: v.optional(v.number()),
      }),
    ),
    organizationId: v.string(),
    agentSlug: v.optional(v.string()),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const ttlMs = args.ttlMs ?? ONE_DAY_MS;

    // Upsert: replace existing entry for the same cache key
    const existing = await ctx.db
      .query('llmResponseCache')
      .withIndex('by_cacheKey', (q) => q.eq('cacheKey', args.cacheKey))
      .first();
    if (existing) {
      await ctx.db.replace(existing._id, {
        cacheKey: args.cacheKey,
        responseText: args.responseText,
        model: args.model,
        provider: args.provider,
        usage: args.usage,
        organizationId: args.organizationId,
        agentSlug: args.agentSlug,
        createdAt: now,
        expiresAt: now + ttlMs,
      });
    } else {
      await ctx.db.insert('llmResponseCache', {
        cacheKey: args.cacheKey,
        responseText: args.responseText,
        model: args.model,
        provider: args.provider,
        usage: args.usage,
        organizationId: args.organizationId,
        agentSlug: args.agentSlug,
        createdAt: now,
        expiresAt: now + ttlMs,
      });
    }
  },
});

export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('llmResponseCache')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(PURGE_BATCH_SIZE);
    for (const entry of expired) {
      await ctx.db.delete(entry._id);
    }
    // Self-reschedule if batch was full (more entries may remain)
    if (expired.length === PURGE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        1000,
        internal.lib.response_cache.internal_mutations.purgeExpired,
        {},
      );
    }
  },
});

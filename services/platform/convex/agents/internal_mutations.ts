import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import {
  knowledgeFileRagStatusValidator,
  routeTuningValidator,
} from './schema';

/**
 * Upsert an "Auto" routing decision into the cache. Fire-and-forget from
 * `resolveAutoRoute` — a write failure must never affect routing. `override`
 * (a user's manual agent switch) always wins over a prior `classified` row.
 */
export const upsertAutoRouteCache = internalMutation({
  args: {
    organizationId: v.string(),
    candidatesHash: v.string(),
    messageKey: v.string(),
    agentSlug: v.string(),
    source: v.union(v.literal('classified'), v.literal('override')),
    nowMs: v.number(),
    language: v.optional(v.string()),
    tuning: v.optional(routeTuningValidator),
    capabilities: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('autoRouteCache')
      .withIndex('by_org_candidates_message', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('candidatesHash', args.candidatesHash)
          .eq('messageKey', args.messageKey),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        agentSlug: args.agentSlug,
        source: args.source,
        // Replace (not merge) the advisory fields so a re-classification can
        // also CLEAR a hint it no longer emits — `undefined` overwrites.
        language: args.language,
        tuning: args.tuning,
        capabilities: args.capabilities,
        hits: existing.hits + 1,
        lastUsedAt: args.nowMs,
      });
    } else {
      await ctx.db.insert('autoRouteCache', {
        organizationId: args.organizationId,
        candidatesHash: args.candidatesHash,
        messageKey: args.messageKey,
        agentSlug: args.agentSlug,
        source: args.source,
        language: args.language,
        tuning: args.tuning,
        capabilities: args.capabilities,
        hits: 1,
        createdAt: args.nowMs,
        lastUsedAt: args.nowMs,
      });
    }
    return null;
  },
});

/**
 * Route-quality feedback. When the user re-sends the SAME message that "Auto"
 * routed to agent X but now explicitly pins a DIFFERENT agent Y, that's a sound
 * correction: fold Y into the cache as an `override` (so the same message
 * auto-routes to Y next time) and clear the thread's pending pointer. Any other
 * shape (different message, same agent) is left untouched — switching agents
 * for a NEW task must not poison the cache. Fire-and-forget from unified_chat.
 */
export const recordRouteOverride = internalMutation({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    explicitSlug: v.string(),
    messageKey: v.string(),
    nowMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    const last = meta?.lastAutoRoute;
    if (
      !meta ||
      !last ||
      last.messageKey !== args.messageKey ||
      last.agentSlug === args.explicitSlug
    ) {
      return null;
    }

    const existing = await ctx.db
      .query('autoRouteCache')
      .withIndex('by_org_candidates_message', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('candidatesHash', last.candidatesHash)
          .eq('messageKey', args.messageKey),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        agentSlug: args.explicitSlug,
        source: 'override',
        // The prior advisory hints were derived for the auto-routed agent; a
        // manual switch to a different agent invalidates them.
        language: undefined,
        tuning: undefined,
        capabilities: undefined,
        lastUsedAt: args.nowMs,
      });
    } else {
      await ctx.db.insert('autoRouteCache', {
        organizationId: args.organizationId,
        candidatesHash: last.candidatesHash,
        messageKey: args.messageKey,
        agentSlug: args.explicitSlug,
        source: 'override',
        hits: 1,
        createdAt: args.nowMs,
        lastUsedAt: args.nowMs,
      });
    }
    // Consume the pointer so the correction fires at most once.
    await ctx.db.patch(meta._id, { lastAutoRoute: undefined });
    return null;
  },
});

/** Purge auto-route cache rows older than `maxAgeMs`. Cron-driven, batched.
 * Index-driven (`by_createdAt`) so it reads ONLY the stale rows instead of
 * scanning the whole table; the batch cap keeps a single run within Convex's
 * per-transaction limits. */
export const purgeAutoRouteCache = internalMutation({
  args: { maxAgeMs: v.number(), limit: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.maxAgeMs;
    const stale = await ctx.db
      .query('autoRouteCache')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(args.limit ?? 2000);
    for (const row of stale) await ctx.db.delete(row._id);
    return stale.length;
  },
});

/**
 * Update RAG indexing status on a knowledge file in the binding record.
 * Called by the async RAG polling pipeline after file upload.
 */
export const updateKnowledgeFileRagInfo = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    fileId: v.id('_storage'),
    ragStatus: knowledgeFileRagStatusValidator,
    ragIndexedAt: v.optional(v.number()),
    ragError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const binding = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();

    if (!binding?.knowledgeFiles) return;

    const updated = binding.knowledgeFiles.map((f) => {
      if (f.fileId !== args.fileId) return f;
      return {
        ...f,
        ragStatus: args.ragStatus,
        ragIndexedAt: args.ragIndexedAt ?? f.ragIndexedAt,
        ragError: args.ragError,
      };
    });

    await ctx.db.patch(binding._id, { knowledgeFiles: updated });
  },
});

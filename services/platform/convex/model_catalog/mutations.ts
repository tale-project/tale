import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';

const capabilityEntry = v.object({
  modelId: v.string(),
  reasoning: v.optional(
    v.object({
      knob: v.union(
        v.literal('effort'),
        v.literal('budgetTokens'),
        v.literal('none'),
      ),
      supportsMinimal: v.optional(v.boolean()),
      minBudgetTokens: v.optional(v.number()),
      maxBudgetTokens: v.optional(v.number()),
    }),
  ),
  promptCaching: v.optional(
    v.object({
      mode: v.union(
        v.literal('explicit-breakpoints'),
        v.literal('auto-server'),
        v.literal('none'),
      ),
      maxBreakpoints: v.optional(v.number()),
    }),
  ),
  inputCentsPerMillion: v.optional(v.number()),
  outputCentsPerMillion: v.optional(v.number()),
  contextWindow: v.optional(v.number()),
  maxOutputTokens: v.optional(v.number()),
  supportsTools: v.optional(v.boolean()),
  supportsVision: v.optional(v.boolean()),
});

/**
 * Upsert a batch of normalized capability rows (one sync chunk). Keyed by
 * `modelId`; the latest fetch wins. `source`/`fetchedAt` stamp provenance.
 */
export const upsertCapabilities = internalMutation({
  args: {
    source: v.string(),
    fetchedAt: v.number(),
    entries: v.array(capabilityEntry),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const e of args.entries) {
      const existing = await ctx.db
        .query('modelCapabilityCache')
        .withIndex('by_modelId', (q) => q.eq('modelId', e.modelId))
        .first();
      const row = { ...e, source: args.source, fetchedAt: args.fetchedAt };
      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert('modelCapabilityCache', row);
      }
    }
    return null;
  },
});

/** Upsert the per-org auto-sync toggle. Called by the developer-gated setter
 *  action; absent row means "enabled" so we only write when toggling. */
export const setAutoSyncEnabled = internalMutation({
  args: {
    organizationId: v.string(),
    enabled: v.boolean(),
    updatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('modelSyncSettings')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        autoSyncEnabled: args.enabled,
        updatedAt: args.updatedAt,
      });
    } else {
      await ctx.db.insert('modelSyncSettings', {
        organizationId: args.organizationId,
        autoSyncEnabled: args.enabled,
        updatedAt: args.updatedAt,
      });
    }
    return null;
  },
});

/** Record a sync run's outcome for the UI status readout. */
export const recordSync = internalMutation({
  args: {
    source: v.string(),
    lastSyncedAt: v.number(),
    modelCount: v.number(),
    ok: v.boolean(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('modelCatalogSync')
      .withIndex('by_source', (q) => q.eq('source', args.source))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSyncedAt: args.lastSyncedAt,
        modelCount: args.modelCount,
        ok: args.ok,
        error: args.error,
      });
    } else {
      await ctx.db.insert('modelCatalogSync', args);
    }
    return null;
  },
});

import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { buildPeriodKeyFromTimestamp } from './helpers';

export const incrementUsageLedger = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    teamId: v.optional(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costEstimateCents: v.number(),
    timestamp: v.number(),
    period: v.optional(
      v.union(v.literal('daily'), v.literal('weekly'), v.literal('monthly')),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const period = args.period ?? 'monthly';
    const periodKey = buildPeriodKeyFromTimestamp(period, args.timestamp);
    const totalTokens = args.inputTokens + args.outputTokens;

    const existing = await ctx.db
      .query('usageLedger')
      .withIndex('by_org_user_period', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', args.userId)
          .eq('periodKey', periodKey),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        inputTokens: existing.inputTokens + args.inputTokens,
        outputTokens: existing.outputTokens + args.outputTokens,
        totalTokens: existing.totalTokens + totalTokens,
        costEstimate: existing.costEstimate + args.costEstimateCents,
        requestCount: existing.requestCount + 1,
      });
    } else {
      await ctx.db.insert('usageLedger', {
        organizationId: args.organizationId,
        userId: args.userId,
        teamId: args.teamId,
        periodKey,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        totalTokens,
        costEstimate: args.costEstimateCents,
        requestCount: 1,
      });

      // Guard against duplicate-insert race: if two concurrent mutations
      // both saw existing===null and inserted, merge into the older row.
      const allEntries = await ctx.db
        .query('usageLedger')
        .withIndex('by_org_user_period', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('userId', args.userId)
            .eq('periodKey', periodKey),
        )
        .collect();

      if (allEntries.length > 1) {
        // Keep the oldest entry, merge the rest into it
        const sorted = allEntries.sort(
          (a, b) => a._creationTime - b._creationTime,
        );
        const keep = sorted[0];
        if (!keep) return null;
        for (let i = 1; i < sorted.length; i++) {
          const dup = sorted[i];
          if (!dup) continue;
          await ctx.db.patch(keep._id, {
            inputTokens: keep.inputTokens + dup.inputTokens,
            outputTokens: keep.outputTokens + dup.outputTokens,
            totalTokens: keep.totalTokens + dup.totalTokens,
            costEstimate: keep.costEstimate + dup.costEstimate,
            requestCount: keep.requestCount + dup.requestCount,
          });
          await ctx.db.delete(dup._id);
        }
      }
    }

    return null;
  },
});

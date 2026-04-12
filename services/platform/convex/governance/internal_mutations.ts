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
    const ALL_PERIODS = ['daily', 'weekly', 'monthly'] as const;
    const totalTokens = args.inputTokens + args.outputTokens;

    for (const period of ALL_PERIODS) {
      const periodKey = buildPeriodKeyFromTimestamp(period, args.timestamp);

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
          // Backfill teamId if the existing entry has none and we now have one
          ...(args.teamId && !existing.teamId ? { teamId: args.teamId } : {}),
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
        const dupQuery = ctx.db
          .query('usageLedger')
          .withIndex('by_org_user_period', (q) =>
            q
              .eq('organizationId', args.organizationId)
              .eq('userId', args.userId)
              .eq('periodKey', periodKey),
          );
        const allEntries = [];
        for await (const entry of dupQuery) {
          allEntries.push(entry);
        }

        if (allEntries.length > 1) {
          // Keep the oldest entry, sum all entries, then patch once.
          // We must NOT read from the local `keep` object after patching
          // because ctx.db.patch does not update the in-memory reference.
          const sorted = allEntries.sort(
            (a, b) => a._creationTime - b._creationTime,
          );
          const keep = sorted[0];
          if (!keep) continue;

          let sumInput = 0;
          let sumOutput = 0;
          let sumTotal = 0;
          let sumCost = 0;
          let sumRequests = 0;
          for (const entry of sorted) {
            sumInput += entry.inputTokens;
            sumOutput += entry.outputTokens;
            sumTotal += entry.totalTokens;
            sumCost += entry.costEstimate;
            sumRequests += entry.requestCount;
          }

          await ctx.db.patch(keep._id, {
            inputTokens: sumInput,
            outputTokens: sumOutput,
            totalTokens: sumTotal,
            costEstimate: sumCost,
            requestCount: sumRequests,
          });

          for (let i = 1; i < sorted.length; i++) {
            const dup = sorted[i];
            if (!dup) continue;
            await ctx.db.delete(dup._id);
          }
        }
      }
    }

    return null;
  },
});

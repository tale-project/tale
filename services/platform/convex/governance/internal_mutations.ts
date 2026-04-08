import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { buildPeriodKey } from './helpers';

export const incrementUsageLedger = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    teamId: v.optional(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costEstimateCents: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const periodKey = buildPeriodKey('monthly');
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
        estimatedCostEur: args.costEstimateCents,
        estimatedCostUsd: args.costEstimateCents,
        requestCount: 1,
      });
    }

    return null;
  },
});

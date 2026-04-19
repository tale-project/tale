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
    // Assistant / workflow step slug. Undefined for direct model-API calls.
    agentSlug: v.optional(v.string()),
    // LLM model identifier (e.g. "gpt-4o-mini"). Part of the upsert key.
    model: v.optional(v.string()),
    // LLM provider (e.g. "openai"). Stored only; functionally determined by model.
    provider: v.optional(v.string()),
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
        .withIndex('by_org_user_period_team_agent_model', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('userId', args.userId)
            .eq('periodKey', periodKey)
            .eq('teamId', args.teamId)
            .eq('agentSlug', args.agentSlug)
            .eq('model', args.model),
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          inputTokens: existing.inputTokens + args.inputTokens,
          outputTokens: existing.outputTokens + args.outputTokens,
          totalTokens: existing.totalTokens + totalTokens,
          costEstimate: existing.costEstimate + args.costEstimateCents,
          requestCount: existing.requestCount + 1,
          // Provider is functionally determined by model, but patch it in case
          // the existing row was written before provider was tracked.
          ...(args.provider !== undefined && existing.provider === undefined
            ? { provider: args.provider }
            : {}),
        });
      } else {
        await ctx.db.insert('usageLedger', {
          organizationId: args.organizationId,
          userId: args.userId,
          teamId: args.teamId,
          periodKey,
          granularity: period,
          agentSlug: args.agentSlug,
          model: args.model,
          provider: args.provider,
          inputTokens: args.inputTokens,
          outputTokens: args.outputTokens,
          totalTokens,
          costEstimate: args.costEstimateCents,
          requestCount: 1,
        });

        // Guard against duplicate-insert race: if two concurrent mutations
        // both saw existing===null and inserted, merge into the older row.
        // Filters must match the upsert key exactly (agentSlug + model) so
        // rows from different agents/models are not incorrectly coalesced.
        const dupQuery = ctx.db
          .query('usageLedger')
          .withIndex('by_org_user_period_team_agent_model', (q) =>
            q
              .eq('organizationId', args.organizationId)
              .eq('userId', args.userId)
              .eq('periodKey', periodKey)
              .eq('teamId', args.teamId)
              .eq('agentSlug', args.agentSlug)
              .eq('model', args.model),
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

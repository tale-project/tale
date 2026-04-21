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

/**
 * Record a single external integration call (e.g. Tavily search) in the
 * usageLedger for per-org/per-user accounting. Unlike LLM rows, integration
 * rows use `integrationName` + `integrationOperation` as the dedup key
 * (model is unset) and accumulate `integrationCallCount` + `costEstimate`.
 */
export const recordIntegrationUsage = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    teamId: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    integrationName: v.string(),
    integrationOperation: v.string(),
    costEstimateCents: v.number(),
    timestamp: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ALL_PERIODS = ['daily', 'weekly', 'monthly'] as const;
    for (const period of ALL_PERIODS) {
      const periodKey = buildPeriodKeyFromTimestamp(period, args.timestamp);
      const existingQuery = ctx.db
        .query('usageLedger')
        .withIndex('by_org_user_period_team', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('userId', args.userId)
            .eq('periodKey', periodKey)
            .eq('teamId', args.teamId),
        );
      let match: Awaited<ReturnType<typeof existingQuery.first>> | null = null;
      for await (const entry of existingQuery) {
        if (
          entry.agentSlug === args.agentSlug &&
          entry.integrationName === args.integrationName &&
          entry.integrationOperation === args.integrationOperation
        ) {
          match = entry;
          break;
        }
      }

      if (match) {
        await ctx.db.patch(match._id, {
          integrationCallCount: (match.integrationCallCount ?? 0) + 1,
          costEstimate: match.costEstimate + args.costEstimateCents,
          requestCount: match.requestCount + 1,
        });
      } else {
        await ctx.db.insert('usageLedger', {
          organizationId: args.organizationId,
          userId: args.userId,
          teamId: args.teamId,
          periodKey,
          granularity: period,
          agentSlug: args.agentSlug,
          model: undefined,
          provider: undefined,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costEstimate: args.costEstimateCents,
          requestCount: 1,
          integrationName: args.integrationName,
          integrationOperation: args.integrationOperation,
          integrationCallCount: 1,
        });
      }
    }
    return null;
  },
});

/**
 * Record a transcription (speech-to-text) call to the usage ledger. Billed per
 * minute of audio rather than per token — `inputTokens`/`outputTokens` are left
 * at 0 and `audioDurationSec` carries the billable unit.
 */
export const recordTranscriptionUsage = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    teamId: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    model: v.string(),
    provider: v.string(),
    audioDurationSec: v.number(),
    costEstimateCents: v.number(),
    timestamp: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ALL_PERIODS = ['daily', 'weekly', 'monthly'] as const;
    for (const period of ALL_PERIODS) {
      const periodKey = buildPeriodKeyFromTimestamp(period, args.timestamp);
      const existingQuery = ctx.db
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
      const match = await existingQuery.first();

      if (match) {
        await ctx.db.patch(match._id, {
          audioDurationSec:
            (match.audioDurationSec ?? 0) + args.audioDurationSec,
          costEstimate: match.costEstimate + args.costEstimateCents,
          requestCount: match.requestCount + 1,
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
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costEstimate: args.costEstimateCents,
          requestCount: 1,
          audioDurationSec: args.audioDurationSec,
        });
      }
    }
    return null;
  },
});

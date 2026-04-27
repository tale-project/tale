import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import {
  toolUsageItemValidator,
  citationItemValidator,
  contextStatsValidator,
} from '../streaming/validators';

const MAX_CONTEXT_WINDOW_CHARS = 500_000;

export const saveMessageMetadata = internalMutation({
  args: {
    messageId: v.string(),
    threadId: v.string(),
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    reasoningTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    reasoning: v.optional(v.string()),
    providerMetadata: v.optional(jsonRecordValidator),
    durationMs: v.optional(v.number()),
    timeToFirstTokenMs: v.optional(v.number()),
    toolsUsage: v.optional(v.array(toolUsageItemValidator)),
    citations: v.optional(v.array(citationItemValidator)),
    contextWindow: v.optional(v.string()),
    contextStats: v.optional(contextStatsValidator),
    error: v.optional(v.string()),
    costEstimateCents: v.optional(v.number()),
  },
  returns: v.id('messageMetadata'),
  handler: async (ctx, args) => {
    console.log('[saveMessageMetadata] DEBUG citations:', {
      hasCitations: !!args.citations,
      citationsLength: args.citations?.length,
      firstCitation: args.citations?.[0],
    });
    let contextWindow = args.contextWindow;
    if (contextWindow && contextWindow.length > MAX_CONTEXT_WINDOW_CHARS) {
      console.warn(
        `[saveMessageMetadata] contextWindow truncated from ${contextWindow.length} to ${MAX_CONTEXT_WINDOW_CHARS} chars`,
      );
      contextWindow =
        contextWindow.slice(0, MAX_CONTEXT_WINDOW_CHARS) + '\n... [truncated]';
    }

    const existing = await ctx.db
      .query('messageMetadata')
      .withIndex('by_messageId', (q) => q.eq('messageId', args.messageId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        model: args.model ?? existing.model,
        provider: args.provider ?? existing.provider,
        inputTokens: args.inputTokens ?? existing.inputTokens,
        outputTokens: args.outputTokens ?? existing.outputTokens,
        totalTokens: args.totalTokens ?? existing.totalTokens,
        reasoningTokens: args.reasoningTokens ?? existing.reasoningTokens,
        cachedInputTokens: args.cachedInputTokens ?? existing.cachedInputTokens,
        reasoning: args.reasoning ?? existing.reasoning,
        providerMetadata: args.providerMetadata ?? existing.providerMetadata,
        durationMs: args.durationMs ?? existing.durationMs,
        timeToFirstTokenMs:
          args.timeToFirstTokenMs ?? existing.timeToFirstTokenMs,
        toolsUsage: args.toolsUsage ?? existing.toolsUsage,
        citations: args.citations ?? existing.citations,
        contextWindow: contextWindow ?? existing.contextWindow,
        contextStats: args.contextStats ?? existing.contextStats,
        error: args.error ?? existing.error,
        costEstimateCents: args.costEstimateCents ?? existing.costEstimateCents,
      });
      return existing._id;
    }

    return await ctx.db.insert('messageMetadata', {
      messageId: args.messageId,
      threadId: args.threadId,
      model: args.model ?? '',
      provider: args.provider ?? '',
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens: args.totalTokens,
      reasoningTokens: args.reasoningTokens,
      cachedInputTokens: args.cachedInputTokens,
      reasoning: args.reasoning,
      providerMetadata: args.providerMetadata,
      durationMs: args.durationMs,
      timeToFirstTokenMs: args.timeToFirstTokenMs,
      toolsUsage: args.toolsUsage,
      citations: args.citations,
      contextWindow,
      contextStats: args.contextStats,
      error: args.error,
      costEstimateCents: args.costEstimateCents,
    });
  },
});

/**
 * Record that the guardrails pipeline blocked this assistant message.
 * Stored alongside other message metadata so `useMessageMetadata` picks
 * it up through the same subscription. Called from the output-side
 * persist step either mid-stream (transform detected block) or at the
 * finalize sweep (cross-chunk local match).
 */
export const setBlockedReason = internalMutation({
  args: {
    messageId: v.string(),
    threadId: v.string(),
    code: v.union(
      v.literal('pii.blocked'),
      v.literal('chat_filter.blocked'),
      v.literal('moderation_provider.blocked'),
    ),
    direction: v.union(v.literal('input'), v.literal('output')),
    categoryIds: v.array(v.string()),
    sanitizationRunId: v.string(),
  },
  returns: v.id('messageMetadata'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('messageMetadata')
      .withIndex('by_messageId', (q) => q.eq('messageId', args.messageId))
      .first();

    const blockedReason = {
      code: args.code,
      direction: args.direction,
      categoryIds: args.categoryIds,
      sanitizationRunId: args.sanitizationRunId,
    };

    if (existing) {
      await ctx.db.patch(existing._id, { blockedReason });
      return existing._id;
    }

    return await ctx.db.insert('messageMetadata', {
      messageId: args.messageId,
      threadId: args.threadId,
      model: '',
      provider: '',
      blockedReason,
    });
  },
});

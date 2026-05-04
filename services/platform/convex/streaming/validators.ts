import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

export const toolUsageItemValidator = v.object({
  toolName: v.string(),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  input: v.optional(v.string()),
  output: v.optional(v.string()),
  costEstimateCents: v.optional(v.number()),
});

/** @deprecated Use toolUsageItemValidator */
export const subAgentUsageItemValidator = toolUsageItemValidator;

export const contextStatsValidator = v.object({
  totalTokens: v.number(),
  messageCount: v.number(),
  approvalCount: v.number(),
  hasSummary: v.optional(v.boolean()),
  hasRag: v.boolean(),
  hasWebContext: v.optional(v.boolean()),
  hasIntegrations: v.optional(v.boolean()),
});

export const citationItemValidator = v.object({
  index: v.number(),
  type: v.union(v.literal('rag'), v.literal('web')),
  source: v.string(),
  fileId: v.optional(v.string()),
  url: v.optional(v.string()),
  page: v.optional(v.number()),
  relevance: v.optional(v.number()),
});

export const messageMetadataValidator = v.object({
  _id: v.id('messageMetadata'),
  _creationTime: v.number(),
  messageId: v.string(),
  threadId: v.string(),
  model: v.string(),
  provider: v.string(),
  agentSlug: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
  cachedInputTokens: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  providerMetadata: v.optional(jsonRecordValidator),
  durationMs: v.optional(v.number()),
  timeToFirstTokenMs: v.optional(v.number()),
  subAgentUsage: v.optional(v.array(toolUsageItemValidator)),
  toolsUsage: v.optional(v.array(toolUsageItemValidator)),
  citations: v.optional(v.array(citationItemValidator)),
  contextWindow: v.optional(v.string()),
  contextStats: v.optional(contextStatsValidator),
  error: v.optional(v.string()),
  blockedReason: v.optional(
    v.object({
      code: v.union(
        v.literal('pii.blocked'),
        v.literal('chat_filter.blocked'),
        v.literal('moderation_provider.blocked'),
      ),
      direction: v.union(v.literal('input'), v.literal('output')),
      categoryIds: v.array(v.string()),
      sanitizationRunId: v.string(),
    }),
  ),
  costEstimateCents: v.optional(v.number()),
});

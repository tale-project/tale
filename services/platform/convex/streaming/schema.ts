import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const messageMetadataTable = defineTable({
  messageId: v.string(),
  threadId: v.string(),
  model: v.string(),
  provider: v.string(),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
  cachedInputTokens: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  providerMetadata: v.optional(jsonRecordValidator),
  durationMs: v.optional(v.number()),
  timeToFirstTokenMs: v.optional(v.number()),
  subAgentUsage: v.optional(
    v.array(
      v.object({
        toolName: v.string(),
        model: v.optional(v.string()),
        provider: v.optional(v.string()),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        totalTokens: v.optional(v.number()),
        durationMs: v.optional(v.number()),
        input: v.optional(v.string()),
        output: v.optional(v.string()),
      }),
    ),
  ),
  // Structured context window for debugging (XML-like formatted)
  contextWindow: v.optional(v.string()),
  contextStats: v.optional(
    v.object({
      totalTokens: v.number(),
      messageCount: v.number(),
      approvalCount: v.number(),
      hasSummary: v.optional(v.boolean()), // Deprecated, kept for backward compatibility
      hasRag: v.boolean(),
      hasWebContext: v.optional(v.boolean()),
      hasIntegrations: v.optional(v.boolean()),
    }),
  ),
})
  .index('by_messageId', ['messageId'])
  .index('by_threadId', ['threadId']);

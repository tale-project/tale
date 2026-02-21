/**
 * Shared Convex validators for agent response types.
 *
 * These validators are used by all agent actions to ensure consistent
 * return types across the codebase. They match the TypeScript interfaces
 * defined in ./types.ts
 */

import { v } from 'convex/values';

export const agentUsageValidator = v.object({
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
  cachedInputTokens: v.optional(v.number()),
});

export const contextStatsValidator = v.object({
  totalTokens: v.number(),
  messageCount: v.number(),
  approvalCount: v.number(),
  hasSummary: v.optional(v.boolean()), // Deprecated, kept for backward compatibility
  hasRag: v.boolean(),
  hasWebContext: v.optional(v.boolean()),
  hasIntegrations: v.boolean(),
});

export const toolCallValidator = v.object({
  toolName: v.string(),
  status: v.string(),
});

export const subAgentUsageValidator = v.object({
  toolName: v.string(),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  durationMs: v.optional(v.number()),
});

export const agentResponseReturnsValidator = v.object({
  threadId: v.optional(v.string()),
  text: v.string(),
  usage: v.optional(agentUsageValidator),
  finishReason: v.optional(v.string()),
  durationMs: v.number(),
  timeToFirstTokenMs: v.optional(v.number()),
  toolCalls: v.optional(v.array(toolCallValidator)),
  subAgentUsage: v.optional(v.array(subAgentUsageValidator)),
  contextWindow: v.optional(v.string()),
  contextStats: v.optional(contextStatsValidator),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  reasoning: v.optional(v.string()),
});

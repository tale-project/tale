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

export const agentResponseReturnsValidator = v.object({
  text: v.string(),
  usage: v.optional(agentUsageValidator),
  finishReason: v.optional(v.string()),
  durationMs: v.number(),
});

/**
 * Shared Convex validators for agent response types.
 *
 * These validators are used by all agent actions to ensure consistent
 * return types across the codebase. They match the TypeScript interfaces
 * defined in ./types.ts
 */

import { v } from 'convex/values';

/**
 * Client-supplied environment context (timezone, browser language, and the
 * app UI locale) threaded from the chat entry points down through
 * `runAgentGeneration` into `generateResponse`, where `uiLanguage` feeds the
 * response-language fallback. Centralized here so the shape can't drift across
 * the many actions that accept it — a missing `uiLanguage` on one hop in the
 * chain surfaces as an opaque ArgumentValidationError at runtime.
 */
export const userContextValidator = v.object({
  timezone: v.string(),
  language: v.string(),
  uiLanguage: v.optional(v.string()),
});

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
  hasRag: v.boolean(),
  hasWebContext: v.optional(v.boolean()),
  hasIntegrations: v.optional(v.boolean()),
});

export const toolCallValidator = v.object({
  toolName: v.string(),
  status: v.string(),
});

export const toolUsageValidator = v.object({
  toolName: v.string(),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  input: v.optional(v.string()),
  output: v.optional(v.string()),
});

export const agentResponseReturnsValidator = v.object({
  threadId: v.optional(v.string()),
  text: v.string(),
  usage: v.optional(agentUsageValidator),
  finishReason: v.optional(v.string()),
  durationMs: v.number(),
  timeToFirstTokenMs: v.optional(v.number()),
  thinkingDurationMs: v.optional(v.number()),
  toolCalls: v.optional(v.array(toolCallValidator)),
  toolsUsage: v.optional(v.array(toolUsageValidator)),
  contextWindow: v.optional(v.string()),
  contextStats: v.optional(contextStatsValidator),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  reasoning: v.optional(v.string()),
});

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const llmResponseCacheTable = defineTable({
  cacheKey: v.string(),
  responseText: v.string(),
  model: v.string(),
  provider: v.optional(v.string()),
  usage: v.optional(
    v.object({
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      totalTokens: v.optional(v.number()),
    }),
  ),
  createdAt: v.number(),
  expiresAt: v.number(),
  agentSlug: v.optional(v.string()),
  organizationId: v.string(),
})
  .index('by_cacheKey', ['cacheKey'])
  .index('by_expiresAt', ['expiresAt']);

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * @deprecated Retained only for schema-validation compatibility on
 * deployments that hold prior cache rows. Read/write code paths were
 * removed in 83a3c28da. A follow-up release will purge legacy rows and
 * drop the table once all environments have completed the inactivity
 * window.
 */
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

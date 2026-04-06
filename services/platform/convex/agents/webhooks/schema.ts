import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const agentWebhooksTable = defineTable({
  organizationId: v.string(),
  agentSlug: v.string(),
  token: v.string(),
  isActive: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
})
  .index('by_org', ['organizationId'])
  .index('by_agent', ['organizationId', 'agentSlug'])
  .index('by_token', ['token']);

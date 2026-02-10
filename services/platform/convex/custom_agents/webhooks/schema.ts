import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const customAgentWebhooksTable = defineTable({
  organizationId: v.string(),
  customAgentId: v.id('customAgents'),
  token: v.string(),
  isActive: v.boolean(),
  lastTriggeredAt: v.optional(v.number()),
  createdAt: v.number(),
  createdBy: v.string(),
})
  .index('by_org', ['organizationId'])
  .index('by_agent', ['customAgentId'])
  .index('by_token', ['token']);

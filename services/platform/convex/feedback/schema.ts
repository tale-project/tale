import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const messageFeedbackTable = defineTable({
  organizationId: v.string(),
  threadId: v.string(),
  messageId: v.string(),
  userId: v.string(),
  rating: v.union(v.literal('positive'), v.literal('negative')),
  comment: v.optional(v.string()),
  createdAt: v.number(),
})
  .index('by_messageId_userId', ['messageId', 'userId'])
  .index('by_organizationId', ['organizationId'])
  .index('by_org_rating', ['organizationId', 'rating'])
  .index('by_threadId', ['threadId']);

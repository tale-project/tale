import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';

export const messageFeedbackTable = defineTable({
  organizationId: v.string(),
  threadId: v.string(),
  messageId: v.string(),
  userId: v.string(),
  rating: v.union(v.literal('positive'), v.literal('negative')),
  comment: v.optional(v.string()),
  metadata: v.optional(
    v.object({
      arenaVerdict: v.optional(v.string()),
      modelA: v.optional(v.string()),
      modelB: v.optional(v.string()),
    }),
  ),
  // Server-side attribution copied from messageMetadata at submit time so
  // governance/feedback dashboards can slice by agent / model / provider.
  // Optional because (a) arena rows use a synthetic messageId and rely on
  // metadata.modelA/B instead, and (b) legacy rows pre-date the capture.
  agentSlug: v.optional(v.string()),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  createdAt: v.number(),
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
})
  .index('by_messageId_userId', ['messageId', 'userId'])
  .index('by_organizationId_and_lifecycleStatus', [
    'organizationId',
    'lifecycleStatus',
  ])
  .index('by_organizationId', ['organizationId'])
  .index('by_org_rating', ['organizationId', 'rating'])
  .index('by_threadId', ['threadId'])
  .index('by_org_createdAt', ['organizationId', 'createdAt']);

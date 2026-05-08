import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';

export const promptTemplatesTable = defineTable({
  organizationId: v.string(),
  createdBy: v.string(),
  title: v.string(),
  content: v.string(),
  description: v.optional(v.string()),
  scope: v.union(v.literal('global'), v.literal('team'), v.literal('personal')),
  teamId: v.optional(v.string()),
  category: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  usageCount: v.number(),
  isPublished: v.boolean(),
  /** The message ID this prompt was saved from, if any. */
  sourceMessageId: v.optional(v.string()),
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_lifecycleStatus', [
    'organizationId',
    'lifecycleStatus',
  ])
  .index('by_organizationId_and_scope', ['organizationId', 'scope'])
  .index('by_org_createdBy', ['organizationId', 'createdBy'])
  .index('by_org_teamId', ['organizationId', 'teamId'])
  .index('by_org_category', ['organizationId', 'category'])
  .index('by_org_sourceMessageId', ['organizationId', 'sourceMessageId']);

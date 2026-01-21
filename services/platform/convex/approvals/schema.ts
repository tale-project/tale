import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const approvalsTable = defineTable({
  organizationId: v.string(),
  wfExecutionId: v.optional(v.id('wfExecutions')),
  stepSlug: v.optional(v.string()),
  status: v.union(
    v.literal('pending'),
    v.literal('approved'),
    v.literal('rejected'),
  ),
  approvedBy: v.optional(v.string()),
  reviewedAt: v.optional(v.number()),
  resourceType: v.union(
    v.literal('conversations'),
    v.literal('product_recommendation'),
    v.literal('integration_operation'),
    v.literal('workflow_creation'),
    v.literal('human_input_request'),
  ),
  resourceId: v.string(),
  threadId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  priority: v.union(
    v.literal('low'),
    v.literal('medium'),
    v.literal('high'),
    v.literal('urgent'),
  ),
  dueDate: v.optional(v.number()),
  executedAt: v.optional(v.number()),
  executionError: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_execution', ['wfExecutionId'])
  .index('by_org_status', ['organizationId', 'status'])
  .index('by_org_status_resourceType', [
    'organizationId',
    'status',
    'resourceType',
  ])
  .index('by_resource', ['resourceType', 'resourceId'])
  .index('by_resourceType_and_resourceId_and_status', [
    'resourceType',
    'resourceId',
    'status',
  ])
  .index('by_threadId_status_resourceType', [
    'threadId',
    'status',
    'resourceType',
  ])
  .index('by_threadId', ['threadId']);

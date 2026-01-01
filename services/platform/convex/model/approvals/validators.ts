/**
 * Convex validators for approval operations
 */

import { v } from 'convex/values';

import { priorityValidator } from '../common/validators';

/**
 * Approval status validator
 */
export const approvalStatusValidator = v.union(
  v.literal('pending'),
  v.literal('approved'),
  v.literal('rejected'),
);

/**
 * Approval priority validator (alias for priorityValidator)
 */
export const approvalPriorityValidator = priorityValidator;

/**
 * Approval resource type validator
 */
export const approvalResourceTypeValidator = v.union(
  v.literal('conversations'),
  v.literal('product_recommendation'),
  v.literal('integration_operation'),
);

/**
 * Approval item validator (for responses)
 */
export const approvalItemValidator = v.object({
  _id: v.id('approvals'),
  _creationTime: v.number(),
  organizationId: v.string(),
  wfExecutionId: v.optional(v.id('wfExecutions')),
  stepSlug: v.optional(v.string()),
  status: approvalStatusValidator,
  approvedBy: v.optional(v.string()),
  reviewedAt: v.optional(v.number()),
  resourceType: approvalResourceTypeValidator,
  resourceId: v.string(),
  priority: approvalPriorityValidator,
  dueDate: v.optional(v.number()),
  executedAt: v.optional(v.number()),
  executionError: v.optional(v.string()),
  metadata: v.optional(v.any()),
  threadId: v.optional(v.string()),
  messageId: v.optional(v.string()),
});

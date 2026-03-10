/**
 * Convex validators for approval operations
 *
 * Uses native Convex v.* validators to avoid pulling zod into the query bundle.
 * Zod schemas for client-side validation live in lib/shared/schemas/approvals.ts.
 */

import { v } from 'convex/values';

export const approvalStatusValidator = v.union(
  v.literal('pending'),
  v.literal('approved'),
  v.literal('rejected'),
);

export const approvalPriorityValidator = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('urgent'),
);

export const approvalResourceTypeValidator = v.union(
  v.literal('conversations'),
  v.literal('product_recommendation'),
  v.literal('integration_operation'),
  v.literal('workflow_creation'),
  v.literal('workflow_run'),
  v.literal('workflow_update'),
  v.literal('human_input_request'),
);

export const approvalItemValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  wfExecutionId: v.optional(v.string()),
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

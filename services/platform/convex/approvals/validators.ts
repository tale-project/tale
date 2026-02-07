import { v } from 'convex/values';
import { zodToConvex } from 'convex-helpers/server/zod4';
import {
  approvalStatusSchema,
  approvalPrioritySchema,
  approvalResourceTypeSchema,
} from '../../lib/shared/schemas/approvals';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const approvalStatusValidator = zodToConvex(approvalStatusSchema);
export const approvalPriorityValidator = zodToConvex(approvalPrioritySchema);
export const approvalResourceTypeValidator = zodToConvex(approvalResourceTypeSchema);

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
  metadata: v.optional(jsonRecordValidator),
  threadId: v.optional(v.string()),
  messageId: v.optional(v.string()),
});

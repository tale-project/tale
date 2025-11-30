/**
 * Type definitions for approval operations
 */

import { v } from 'convex/values';
import { Id } from '../../_generated/dataModel';

// =============================================================================
// VALIDATORS
// =============================================================================

/**
 * Approval status validator
 */
export const approvalStatusValidator = v.union(
  v.literal('pending'),
  v.literal('approved'),
  v.literal('rejected'),
);

/**
 * Approval priority validator
 */
export const approvalPriorityValidator = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('urgent'),
);

/**
 * Approval resource type validator
 */
export const approvalResourceTypeValidator = v.union(
  v.literal('conversations'),
  v.literal('product_recommendation'),
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
  metadata: v.optional(v.any()),
});

// =============================================================================
// TYPESCRIPT TYPES
// =============================================================================

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalPriority = 'low' | 'medium' | 'high' | 'urgent';
export type ApprovalResourceType = 'conversations' | 'product_recommendation';

export interface CreateApprovalArgs {
  organizationId: string;
  resourceType: ApprovalResourceType;
  resourceId: string;
  priority: ApprovalPriority;
  requestedBy?: string;
  dueDate?: number;
  description?: string;
  wfExecutionId?: Id<'wfExecutions'>;
  stepSlug?: string;
  metadata?: unknown;
}

export interface UpdateApprovalStatusArgs {
  approvalId: Id<'approvals'>;
  status: ApprovalStatus;
  approvedBy: string;
  comments?: string;
}

export interface ListApprovalsArgs {
  organizationId: string;
  resourceType?: ApprovalResourceType;
  status?: ApprovalStatus;
  wfExecutionId?: Id<'wfExecutions'>;
}

export interface GetApprovalHistoryArgs {
  resourceType: ApprovalResourceType;
  resourceId: string;
}

export interface ApprovalItem {
  _id: Id<'approvals'>;
  _creationTime: number;
  organizationId: string;
  wfExecutionId?: Id<'wfExecutions'>;
  stepSlug?: string;
  status: ApprovalStatus;
  approvedBy?: string;
  reviewedAt?: number;
  resourceType: ApprovalResourceType;
  resourceId: string;
  priority: ApprovalPriority;
  dueDate?: number;
  metadata?: unknown;
}

/**
 * Approvals API - Thin wrappers around model functions
 */

import { v } from 'convex/values';
import { internalQuery, internalMutation } from './_generated/server';
import { queryWithRLS, mutationWithRLS } from './lib/rls';
import * as ApprovalsModel from './model/approvals';

// =============================================================================
// INTERNAL OPERATIONS
// =============================================================================

/**
 * Create a new approval (internal operation)
 */
export const createApproval = internalMutation({
  args: {
    organizationId: v.string(),
    resourceType: ApprovalsModel.approvalResourceTypeValidator,
    resourceId: v.string(),
    priority: ApprovalsModel.approvalPriorityValidator,
    requestedBy: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    description: v.optional(v.string()),
    wfExecutionId: v.optional(v.id('wfExecutions')),
    stepSlug: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.id('approvals'),
  handler: async (ctx, args) => {
    return await ApprovalsModel.createApproval(ctx, args);
  },
});

/**
 * Get an approval by ID (internal operation)
 */
export const getApprovalById = internalQuery({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: v.union(ApprovalsModel.approvalItemValidator, v.null()),
  handler: async (ctx, args) => {
    return await ApprovalsModel.getApproval(ctx, args.approvalId);
  },
});

/**
 * Update approval status (internal operation)
 */
export const updateApprovalStatus = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    status: ApprovalsModel.approvalStatusValidator,
    approvedBy: v.string(),
    comments: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ApprovalsModel.updateApprovalStatus(ctx, args);
    return null;
  },
});

/**
 * List pending approvals for organization (internal operation)
 */
export const listPendingApprovals = internalQuery({
  args: {
    organizationId: v.string(),
    resourceType: v.optional(ApprovalsModel.approvalResourceTypeValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(ApprovalsModel.approvalItemValidator),
  handler: async (ctx, args) => {
    return await ApprovalsModel.listPendingApprovals(ctx, args);
  },
});

/**
 * List all approvals for a workflow execution (internal operation)
 */
export const listApprovalsForExecution = internalQuery({
  args: {
    executionId: v.id('wfExecutions'),
  },
  returns: v.array(ApprovalsModel.approvalItemValidator),
  handler: async (ctx, args) => {
    return await ApprovalsModel.listApprovalsForExecution(
      ctx,
      args.executionId,
    );
  },
});

/**
 * List pending approvals for a workflow execution (internal operation)
 */
export const listPendingApprovalsForExecution = internalQuery({
  args: {
    executionId: v.id('wfExecutions'),
  },
  returns: v.array(ApprovalsModel.approvalItemValidator),
  handler: async (ctx, args) => {
    return await ApprovalsModel.listPendingApprovalsForExecution(
      ctx,
      args.executionId,
    );
  },
});

/**
 * Get approval history for a resource (internal operation)
 */
export const getApprovalHistory = internalQuery({
  args: {
    resourceType: ApprovalsModel.approvalResourceTypeValidator,
    resourceId: v.string(),
  },
  returns: v.array(ApprovalsModel.approvalItemValidator),
  handler: async (ctx, args) => {
    return await ApprovalsModel.getApprovalHistory(ctx, args);
  },
});

// =============================================================================
// PUBLIC API OPERATIONS (with RLS)
// =============================================================================

/**
 * Get an approval by ID (public)
 */
export const getApproval = queryWithRLS({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: v.union(ApprovalsModel.approvalItemValidator, v.null()),
  handler: async (ctx, args) => {
    return await ApprovalsModel.getApproval(ctx, args.approvalId);
  },
});

/**
 * List approvals for organization with status and resourceType filters (public)
 */
export const getApprovalsByOrganization = queryWithRLS({
  args: {
    organizationId: v.string(),
    status: v.union(v.literal('pending'), v.literal('resolved')),
    // resourceType can be a single type or an array of types
    resourceType: v.optional(
      v.union(
        ApprovalsModel.approvalResourceTypeValidator,
        v.array(ApprovalsModel.approvalResourceTypeValidator),
      ),
    ),
    limit: v.optional(v.number()),
  },
  returns: v.array(ApprovalsModel.approvalItemValidator),
  handler: async (ctx, args) => {
    return await ApprovalsModel.listApprovalsByOrganization(ctx, args);
  },
});

/**
 * Update approval status (public)
 */
export const updateApprovalStatusPublic = mutationWithRLS({
  args: {
    approvalId: v.id('approvals'),
    status: ApprovalsModel.approvalStatusValidator,
    approvedBy: v.string(),
    comments: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ApprovalsModel.updateApprovalStatus(ctx, args);
    return null;
  },
});

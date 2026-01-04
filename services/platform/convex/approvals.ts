/**
 * Approvals API - Thin wrappers around model functions
 * @updated for threadId support in validators
 */

import { v } from 'convex/values';
import { action, internalQuery, internalMutation } from './_generated/server';
import { internal } from './_generated/api';
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
 * Get an approval by ID (alias for use in internal actions)
 */
export const getApprovalInternal = internalQuery({
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
 * Link pending approvals in a thread to a message ID (internal operation)
 * Called after agent stream completes to associate approvals with the message
 */
export const linkApprovalsToMessage = internalMutation({
  args: {
    threadId: v.string(),
    messageId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    return await ApprovalsModel.linkApprovalsToMessage(ctx, args);
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
 * Check if organization has any approvals (fast count query for empty state detection)
 */
export const hasApprovals = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const firstApproval = await ctx.db
      .query('approvals')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    return firstApproval !== null;
  },
});

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
 * List approvals for organization with status, resourceType, and search filters (public)
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
    // Optional search term to filter by customer name, email, or product names
    search: v.optional(v.string()),
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

/**
 * Remove a single recommended product from an approval (public)
 */
export const removeRecommendedProduct = mutationWithRLS({
  args: {
    approvalId: v.id('approvals'),
    productId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ApprovalsModel.removeRecommendedProduct(ctx, args);
    return null;
  },
});

/**
 * Get pending integration approvals for a thread (public)
 */
export const getPendingIntegrationApprovalsForThread = queryWithRLS({
  args: {
    threadId: v.string(),
  },
  returns: v.array(ApprovalsModel.approvalItemValidator),
  handler: async (ctx, args) => {
    // Use the by_threadId_status_resourceType index for efficient querying
    // This returns all approvals (pending, approved, rejected) for this thread
    // so the UI can show both pending approvals and execution results
    // Limit to 100 approvals per thread (reasonable upper bound for a single chat)
    const query = ctx.db
      .query('approvals')
      .withIndex('by_threadId_status_resourceType', (q) =>
        q.eq('threadId', args.threadId),
      )
      .filter((q) => q.eq(q.field('resourceType'), 'integration_operation'));

    const approvals = [];
    for await (const approval of query) {
      approvals.push(approval);
      if (approvals.length >= 100) break;
    }
    return approvals;
  },
});

/**
 * Get workflow creation approvals for a thread (public)
 */
export const getWorkflowCreationApprovalsForThread = queryWithRLS({
  args: {
    threadId: v.string(),
  },
  returns: v.array(ApprovalsModel.approvalItemValidator),
  handler: async (ctx, args) => {
    // Use the by_threadId_status_resourceType index for efficient querying
    // This returns all workflow_creation approvals (pending, approved, rejected) for this thread
    // Limit to 100 approvals per thread (reasonable upper bound for a single chat)
    const query = ctx.db
      .query('approvals')
      .withIndex('by_threadId_status_resourceType', (q) =>
        q.eq('threadId', args.threadId),
      )
      .filter((q) => q.eq(q.field('resourceType'), 'workflow_creation'));

    const approvals = [];
    for await (const approval of query) {
      approvals.push(approval);
      if (approvals.length >= 100) break;
    }
    return approvals;
  },
});

// =============================================================================
// PUBLIC ACTIONS (for integration approvals)
// =============================================================================

/**
 * Execute an approved integration operation (public action)
 *
 * This action is called from the frontend when a user approves an integration
 * operation. It first updates the approval status to 'approved' and then
 * executes the operation.
 */
export const executeApprovedIntegrationOperation = action({
  args: {
    approvalId: v.id('approvals'),
    approvedBy: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    const { approvalId, approvedBy } = args;

    // Get the approval to validate it's for an integration operation
    const approval = await ctx.runQuery(internal.approvals.getApprovalInternal, {
      approvalId,
    });

    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'pending') {
      throw new Error(
        `Cannot execute operation: approval status is "${approval.status}", expected "pending"`,
      );
    }

    if (approval.resourceType !== 'integration_operation') {
      throw new Error(
        `Invalid approval type: expected "integration_operation", got "${approval.resourceType}"`,
      );
    }

    // Update the approval status to approved
    await ctx.runMutation(internal.approvals.updateApprovalStatus, {
      approvalId,
      status: 'approved',
      approvedBy,
    });

    // Execute the operation via internal action
    const result: unknown = await ctx.runAction(
      internal.agent_tools.integrations.execute_approved_operation
        .executeApprovedOperation,
      {
        approvalId,
        approvedBy,
      },
    );

    return result;
  },
});

/**
 * Execute an approved workflow creation (public action)
 *
 * This action is called from the frontend when a user approves a workflow
 * creation. It first updates the approval status to 'approved' and then
 * creates the workflow.
 */
export const executeApprovedWorkflowCreation = action({
  args: {
    approvalId: v.id('approvals'),
    approvedBy: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    const { approvalId, approvedBy } = args;

    // Get the approval to validate it's for a workflow creation
    const approval = await ctx.runQuery(internal.approvals.getApprovalInternal, {
      approvalId,
    });

    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'pending') {
      throw new Error(
        `Cannot execute workflow creation: approval status is "${approval.status}", expected "pending"`,
      );
    }

    if (approval.resourceType !== 'workflow_creation') {
      throw new Error(
        `Invalid approval type: expected "workflow_creation", got "${approval.resourceType}"`,
      );
    }

    // Update the approval status to approved
    await ctx.runMutation(internal.approvals.updateApprovalStatus, {
      approvalId,
      status: 'approved',
      approvedBy,
    });

    // Execute the workflow creation via internal action
    const result: unknown = await ctx.runAction(
      internal.agent_tools.workflows.execute_approved_workflow_creation
        .executeApprovedWorkflowCreation,
      {
        approvalId,
        approvedBy,
      },
    );

    return result;
  },
});

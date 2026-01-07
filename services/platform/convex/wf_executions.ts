/**
 * Workflow Executions API
 * Thin wrappers around business logic functions
 */

import {
  internalQuery,
  internalMutation,
  query,
  action,
} from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import * as WfExecutionsModel from './model/wf_executions';

// =============================================================================
// INTERNAL OPERATIONS
// =============================================================================

/**
 * Get execution by ID
 */
export const getExecution = internalQuery({
  args: { executionId: v.id('wfExecutions') },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await WfExecutionsModel.getExecution(ctx, args.executionId);
  },
});

/**
 * Get raw execution by ID (without deserializing variables)
 */
export const getRawExecution = internalQuery({
  args: { executionId: v.id('wfExecutions') },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await WfExecutionsModel.getRawExecution(ctx, args.executionId);
  },
});

/**
 * List executions for workflow
 */
export const listExecutions = query({
  args: WfExecutionsModel.listExecutionsArgsValidator,
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await WfExecutionsModel.listExecutions(ctx, args);
  },
});

/**
 * List executions for workflow with offset-based pagination
 */
export const listExecutionsPaginated = query({
  args: WfExecutionsModel.listExecutionsPaginatedArgsValidator,
  returns: v.object({
    items: v.array(v.any()),
    total: v.number(),
    page: v.number(),
    pageSize: v.number(),
    totalPages: v.number(),
    hasNextPage: v.boolean(),
    hasPreviousPage: v.boolean(),
    hasMore: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    return await WfExecutionsModel.listExecutionsPaginated(ctx, args);
  },
});

/**
 * Update execution status
 */
export const updateExecutionStatus = internalMutation({
  args: WfExecutionsModel.updateExecutionStatusArgsValidator,
  returns: v.null(),
  handler: async (ctx, args) => {
    return await WfExecutionsModel.updateExecutionStatus(ctx, args);
  },
});

/**
 * Complete execution
 */
export const completeExecution = internalMutation({
  args: WfExecutionsModel.completeExecutionArgsValidator,
  returns: v.null(),
  handler: async (ctx, args) => {
    return await WfExecutionsModel.completeExecution(ctx, args);
  },
});

/**
 * Fail execution
 */
export const failExecution = internalMutation({
  args: WfExecutionsModel.failExecutionArgsValidator,
  returns: v.null(),
  handler: async (ctx, args) => {
    return await WfExecutionsModel.failExecution(ctx, args);
  },
});

/**
 * Update execution variables
 */
export const updateExecutionVariables = internalMutation({
  args: WfExecutionsModel.updateExecutionVariablesArgsValidator,
  returns: v.null(),
  handler: async (ctx, args) => {
    return await WfExecutionsModel.updateExecutionVariables(ctx, args);
  },
});

/**
 * Get workflow execution statistics (public)
 */
export const getWorkflowExecutionStats = query({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await WfExecutionsModel.getWorkflowExecutionStats(ctx, args);
  },
});

/**
 * Get combined step journal for an execution (public)
 */
export const getExecutionStepJournal = query({
  args: {
    executionId: v.id('wfExecutions'),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await WfExecutionsModel.getExecutionStepJournal(ctx, args);
  },
});

/**
 * Cancel workflow execution (public)
 */
export const cancelExecution = action({
  args: {
    executionId: v.id('wfExecutions'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Call internal mutation to properly cancel the execution
    await ctx.runMutation(internal.wf_executions.failExecution, {
      executionId: args.executionId,
      error: 'cancelled',
    });
    return null;
  },
});

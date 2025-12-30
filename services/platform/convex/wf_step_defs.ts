/**
 * Workflow step definitions API
 */

import {
  internalQuery,
  internalMutation,
  query,
} from './_generated/server';
import { v } from 'convex/values';
import * as WfStepDefsModel from './model/wf_step_defs';

// =============================================================================
// Internal Queries
// =============================================================================

export const getOrderedSteps = internalQuery({
  args: WfStepDefsModel.getOrderedStepsArgsValidator,
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await WfStepDefsModel.getOrderedSteps(ctx, args);
  },
});

export const listWorkflowSteps = internalQuery({
  args: WfStepDefsModel.listWorkflowStepsArgsValidator,
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await WfStepDefsModel.listWorkflowSteps(ctx, args);
  },
});

export const getStepById = internalQuery({
  args: { stepId: v.id('wfStepDefs') },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.stepId);
  },
});

// =============================================================================
// Public Queries
// =============================================================================

export const getWorkflowStepsPublic = query({
  args: WfStepDefsModel.listWorkflowStepsArgsValidator,
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await WfStepDefsModel.listWorkflowSteps(ctx, args);
  },
});

// =============================================================================
// Internal Mutations
// =============================================================================

export const createStep = internalMutation({
  args: WfStepDefsModel.createStepArgsValidator,
  returns: v.id('wfStepDefs'),
  handler: async (ctx, args) => {
    return await WfStepDefsModel.createStep(ctx, args);
  },
});

export const deleteStep = internalMutation({
  args: WfStepDefsModel.deleteStepArgsValidator,
  returns: v.null(),
  handler: async (ctx, args) => {
    return await WfStepDefsModel.deleteStep(ctx, args);
  },
});

export const updateStep = internalMutation({
  args: WfStepDefsModel.updateStepArgsValidator,
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await WfStepDefsModel.updateStep(ctx, args);
  },
});

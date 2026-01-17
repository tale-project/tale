/**
 * Workflow Step Definitions Queries
 *
 * All query operations for workflow step definitions.
 * Business logic is in convex/models/wf_step_defs/
 */

import { internalQuery, query } from '../_generated/server';
import { v } from 'convex/values';
import * as WfStepDefsModel from '../models/wf_step_defs';

// =============================================================================
// Internal Queries
// =============================================================================

export const getOrderedSteps = internalQuery({
  args: WfStepDefsModel.getOrderedStepsArgsValidator,
  returns: v.array(WfStepDefsModel.wfStepDefDocValidator),
  handler: async (ctx, args) => {
    return await WfStepDefsModel.getOrderedSteps(ctx, args);
  },
});

export const listWorkflowSteps = internalQuery({
  args: WfStepDefsModel.listWorkflowStepsArgsValidator,
  returns: v.array(WfStepDefsModel.wfStepDefDocValidator),
  handler: async (ctx, args) => {
    return await WfStepDefsModel.listWorkflowSteps(ctx, args);
  },
});

export const getStepById = internalQuery({
  args: { stepId: v.id('wfStepDefs') },
  returns: v.union(WfStepDefsModel.wfStepDefDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.stepId);
  },
});

// =============================================================================
// Public Queries
// =============================================================================

export const getWorkflowStepsPublic = query({
  args: WfStepDefsModel.listWorkflowStepsArgsValidator,
  returns: v.array(WfStepDefsModel.wfStepDefDocValidator),
  handler: async (ctx, args) => {
    return await WfStepDefsModel.listWorkflowSteps(ctx, args);
  },
});

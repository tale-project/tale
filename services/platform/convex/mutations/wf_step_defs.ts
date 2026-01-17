/**
 * Workflow Step Definitions Mutations
 *
 * All mutation operations for workflow step definitions.
 * Business logic is in convex/models/wf_step_defs/
 */

import { internalMutation } from '../_generated/server';
import { v } from 'convex/values';
import * as WfStepDefsModel from '../models/wf_step_defs';

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
  returns: v.union(WfStepDefsModel.wfStepDefDocValidator, v.null()),
  handler: async (ctx, args) => {
    return await WfStepDefsModel.updateStep(ctx, args);
  },
});

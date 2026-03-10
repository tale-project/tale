import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getOrderedSteps as getOrderedStepsHelper } from '../workflows/steps/get_ordered_steps';
import { listWorkflowSteps as listWorkflowStepsHelper } from '../workflows/steps/list_workflow_steps';

export const getOrderedSteps = internalQuery({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
  },
  handler: async (ctx, args) => {
    return await getOrderedStepsHelper(ctx, args);
  },
});

export const listWorkflowSteps = internalQuery({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
  },
  handler: async (ctx, args) => {
    return await listWorkflowStepsHelper(ctx, args);
  },
});

export const getStepById = internalQuery({
  args: {
    stepId: v.id('wfStepDefs'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.stepId);
  },
});

export const getStepWithWorkflowInfo = internalQuery({
  args: {
    stepId: v.id('wfStepDefs'),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.stepId);
    if (!step) return null;

    const workflow = await ctx.db.get(step.wfDefinitionId);
    if (!workflow) return null;

    return {
      step,
      workflowId: step.wfDefinitionId,
      workflowName: workflow.name,
      workflowVersionNumber: workflow.versionNumber,
    };
  },
});

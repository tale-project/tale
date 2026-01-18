/**
 * Public and internal mutations for creating workflows
 */

import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { mutationWithRLS } from '../../lib/rls';
import { createWorkflowWithSteps as createWorkflowWithStepsHelper } from '../../workflows/definitions/create_workflow_with_steps';
import { stepConfigValidator } from '../../workflow_engine/types/nodes';
import { workflowConfigValidator } from '../../workflows/definitions/validators';

const workflowConfigArg = v.object({
  name: v.string(),
  description: v.optional(v.string()),
  version: v.optional(v.string()),
  workflowType: v.optional(v.literal('predefined')),
  config: v.optional(workflowConfigValidator),
});

const stepsConfigArg = v.array(
  v.object({
    stepSlug: v.string(),
    name: v.string(),
    stepType: v.union(
      v.literal('trigger'),
      v.literal('llm'),
      v.literal('condition'),
      v.literal('action'),
      v.literal('loop'),
    ),
    order: v.number(),
    config: stepConfigValidator,
    nextSteps: v.record(v.string(), v.string()),
  }),
);

export const createWorkflowWithStepsPublic = mutationWithRLS({
  args: {
    organizationId: v.string(),
    workflowConfig: workflowConfigArg,
    stepsConfig: stepsConfigArg,
  },
  handler: async (ctx, args) => {
    return await createWorkflowWithStepsHelper(ctx, args);
  },
});

export const createWorkflowWithSteps = internalMutation({
  args: {
    organizationId: v.string(),
    workflowConfig: workflowConfigArg,
    stepsConfig: stepsConfigArg,
  },
  handler: async (ctx, args) => {
    return await createWorkflowWithStepsHelper(ctx, args);
  },
});

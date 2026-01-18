/**
 * Public and internal mutations for updating workflows
 */

import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { mutationWithRLS } from '../../lib/rls';
import { updateWorkflow as updateWorkflowHelper } from '../../workflows/definitions/update_workflow';
import { updateWorkflowStatus as updateWorkflowStatusHelper } from '../../workflows/definitions/update_workflow_status';
import { saveWorkflowWithSteps as saveWorkflowWithStepsHelper } from '../../workflows/definitions/save_workflow_with_steps';
import { workflowUpdateValidator, workflowConfigValidator } from '../../workflows/definitions/validators';
import { stepConfigValidator } from '../../workflow_engine/types/nodes';
import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';

export const updateWorkflowPublic = mutationWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    updates: workflowUpdateValidator,
    updatedBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await updateWorkflowHelper(ctx, args);
  },
});

export const updateWorkflowMetadata = mutationWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    metadata: jsonRecordValidator,
    updatedBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await updateWorkflowHelper(ctx, {
      wfDefinitionId: args.wfDefinitionId,
      updates: { metadata: args.metadata },
      updatedBy: args.updatedBy,
    });
  },
});

export const updateWorkflowStatus = internalMutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    status: v.string(),
    updatedBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await updateWorkflowStatusHelper(ctx, args);
  },
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

export const saveWorkflowWithSteps = internalMutation({
  args: {
    organizationId: v.string(),
    workflowId: v.id('wfDefinitions'),
    workflowConfig: v.object({
      description: v.optional(v.string()),
      version: v.optional(v.string()),
      workflowType: v.optional(v.literal('predefined')),
      config: v.optional(workflowConfigValidator),
    }),
    stepsConfig: stepsConfigArg,
  },
  handler: async (ctx, args) => {
    return await saveWorkflowWithStepsHelper(ctx, args);
  },
});

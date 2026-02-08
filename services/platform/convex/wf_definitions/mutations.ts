import { v } from 'convex/values';
import { mutationWithRLS } from '../lib/rls';
import { createWorkflowWithSteps as createWorkflowWithStepsHelper } from '../workflows/definitions/create_workflow_with_steps';
import { createDraftFromActive as createDraftFromActiveHelper } from '../workflows/definitions/create_draft_from_active';
import { deleteWorkflow as deleteWorkflowHelper } from '../workflows/definitions/delete_workflow';
import { duplicateWorkflow as duplicateWorkflowHelper } from '../workflows/definitions/duplicate_workflow';
import { publishDraft as publishDraftLogic } from '../workflows/definitions/publish_draft';
import { republishWorkflow as republishWorkflowHelper } from '../workflows/definitions/republish_workflow';
import { unpublishWorkflow as unpublishWorkflowHelper } from '../workflows/definitions/unpublish_workflow';
import { updateWorkflow as updateWorkflowHelper } from '../workflows/definitions/update_workflow';
import { workflowConfigValidator, workflowUpdateValidator } from '../workflows/definitions/validators';
import { stepConfigValidator } from '../workflow_engine/types/nodes';
import { stepTypeValidator } from '../workflows/steps/validators';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

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
    stepType: stepTypeValidator,
    order: v.number(),
    config: stepConfigValidator,
    nextSteps: v.record(v.string(), v.string()),
  }),
);

export const createWorkflowWithSteps = mutationWithRLS({
  args: {
    organizationId: v.string(),
    workflowConfig: workflowConfigArg,
    stepsConfig: stepsConfigArg,
  },
  handler: async (ctx, args) => {
    return await createWorkflowWithStepsHelper(ctx, args);
  },
});

export const createDraftFromActive = mutationWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await createDraftFromActiveHelper(ctx, args);
  },
});

export const deleteWorkflow = mutationWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
  },
  handler: async (ctx, args) => {
    return await deleteWorkflowHelper(ctx, args.wfDefinitionId);
  },
});

export const duplicateWorkflow = mutationWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    newName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await duplicateWorkflowHelper(ctx, args);
  },
});

export const publishDraft = mutationWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    publishedBy: v.string(),
    changeLog: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await publishDraftLogic(ctx, args);
  },
});

export const republishWorkflow = mutationWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    publishedBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await republishWorkflowHelper(ctx, args);
  },
});

export const unpublishWorkflow = mutationWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    updatedBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await unpublishWorkflowHelper(ctx, args);
  },
});

export const updateWorkflow = mutationWithRLS({
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

import { v } from 'convex/values';

import { api } from '../_generated/api';
import { action } from '../_generated/server';
import { stepConfigValidator } from '../workflow_engine/types/nodes';
import { workflowConfigValidator } from '../workflows/definitions/validators';
import { stepTypeValidator } from '../workflows/steps/validators';

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

export const createWorkflowWithSteps = action({
  args: {
    organizationId: v.string(),
    workflowConfig: workflowConfigArg,
    stepsConfig: stepsConfigArg,
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(
      api.wf_definitions.mutations.createWorkflowWithSteps,
      args,
    );
  },
});

export const duplicateWorkflow = action({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    newName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(
      api.wf_definitions.mutations.duplicateWorkflow,
      args,
    );
  },
});

export const publishDraft = action({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    publishedBy: v.string(),
    changeLog: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(
      api.wf_definitions.mutations.publishDraft,
      args,
    );
  },
});

export const unpublishWorkflow = action({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    updatedBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(
      api.wf_definitions.mutations.unpublishWorkflow,
      args,
    );
  },
});

export const republishWorkflow = action({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    publishedBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(
      api.wf_definitions.mutations.republishWorkflow,
      args,
    );
  },
});

export const createDraftFromActive = action({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(
      api.wf_definitions.mutations.createDraftFromActive,
      args,
    );
  },
});

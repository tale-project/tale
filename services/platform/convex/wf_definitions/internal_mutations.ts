import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { stepConfigValidator } from '../workflow_engine/types/nodes';
import { createWorkflowWithSteps as createWorkflowWithStepsHelper } from '../workflows/definitions/create_workflow_with_steps';
import {
  cancelAndDeleteExecutionsBatch,
  deleteAuditLogsBatch,
  deleteStepsAndDefinition,
} from '../workflows/definitions/delete_workflow';
import { publishDraft as publishDraftHandler } from '../workflows/definitions/publish_draft';
import { saveWorkflowWithSteps as saveWorkflowWithStepsHelper } from '../workflows/definitions/save_workflow_with_steps';
import { updateWorkflowStatus as updateWorkflowStatusHelper } from '../workflows/definitions/update_workflow_status';
import {
  workflowConfigValidator,
  workflowStatusValidator,
} from '../workflows/definitions/validators';
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

export const provisionWorkflowWithSteps = internalMutation({
  args: {
    organizationId: v.string(),
    workflowConfig: workflowConfigArg,
    stepsConfig: stepsConfigArg,
  },
  handler: async (ctx, args) => {
    return await createWorkflowWithStepsHelper(ctx, args);
  },
});

export const provisionPublishDraft = internalMutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    publishedBy: v.string(),
    changeLog: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await publishDraftHandler(ctx, args);
  },
});

export const updateWorkflowStatus = internalMutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    status: workflowStatusValidator,
    updatedBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await updateWorkflowStatusHelper(ctx, args);
  },
});

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

export const batchDeleteWorkflowExecutions = internalMutation({
  args: {
    wfDefinitionIds: v.array(v.id('wfDefinitions')),
    currentIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const { wfDefinitionIds, currentIndex } = args;

    if (currentIndex >= wfDefinitionIds.length) {
      return;
    }

    const currentDefinitionId = wfDefinitionIds[currentIndex];
    if (!currentDefinitionId) {
      return;
    }

    const result = await cancelAndDeleteExecutionsBatch(
      ctx,
      currentDefinitionId,
    );

    if (result.hasMore) {
      await ctx.scheduler.runAfter(
        0,
        internal.wf_definitions.internal_mutations
          .batchDeleteWorkflowExecutions,
        {
          wfDefinitionIds,
          currentIndex,
        },
      );
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.wf_definitions.internal_mutations.batchDeleteWorkflowAuditLogs,
        {
          wfDefinitionIds,
          currentIndex,
        },
      );
    }
  },
});

export const batchDeleteWorkflowAuditLogs = internalMutation({
  args: {
    wfDefinitionIds: v.array(v.id('wfDefinitions')),
    currentIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const { wfDefinitionIds, currentIndex } = args;

    if (currentIndex >= wfDefinitionIds.length) {
      return;
    }

    const currentDefinitionId = wfDefinitionIds[currentIndex];
    if (!currentDefinitionId) {
      return;
    }

    const result = await deleteAuditLogsBatch(ctx, currentDefinitionId);

    if (result.hasMore) {
      await ctx.scheduler.runAfter(
        0,
        internal.wf_definitions.internal_mutations.batchDeleteWorkflowAuditLogs,
        {
          wfDefinitionIds,
          currentIndex,
        },
      );
    } else {
      await deleteStepsAndDefinition(ctx, currentDefinitionId);

      if (currentIndex + 1 < wfDefinitionIds.length) {
        await ctx.scheduler.runAfter(
          0,
          internal.wf_definitions.internal_mutations
            .batchDeleteWorkflowExecutions,
          {
            wfDefinitionIds,
            currentIndex: currentIndex + 1,
          },
        );
      }
    }
  },
});

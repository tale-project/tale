import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { mutationWithRLS } from '../lib/rls';
import { createWorkflowWithSteps as createWorkflowWithStepsHelper } from '../workflows/definitions/create_workflow_with_steps';
import { createDraftFromActive as createDraftFromActiveHelper } from '../workflows/definitions/create_draft_from_active';
import {
  deleteWorkflow as deleteWorkflowHelper,
  cancelAndDeleteExecutionsBatch,
  deleteAuditLogsBatch,
  deleteStepsAndDefinition,
} from '../workflows/definitions/delete_workflow';
import { duplicateWorkflow as duplicateWorkflowHelper } from '../workflows/definitions/duplicate_workflow';
import { publishDraft as publishDraftLogic } from '../workflows/definitions/publish_draft';
import { saveWorkflowWithSteps as saveWorkflowWithStepsHelper } from '../workflows/definitions/save_workflow_with_steps';
import { updateWorkflow as updateWorkflowHelper } from '../workflows/definitions/update_workflow';
import { updateWorkflowStatus as updateWorkflowStatusHelper } from '../workflows/definitions/update_workflow_status';
import { workflowConfigValidator, workflowUpdateValidator } from '../workflows/definitions/validators';
import { stepConfigValidator } from '../workflow_engine/types/nodes';
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

export const provisionPublishDraft = internalMutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    publishedBy: v.string(),
    changeLog: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await publishDraftLogic(ctx, args);
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

    const result = await cancelAndDeleteExecutionsBatch(ctx, currentDefinitionId);

    if (result.hasMore) {
      await ctx.scheduler.runAfter(
        0,
        internal.wf_definitions.mutations.batchDeleteWorkflowExecutions,
        {
          wfDefinitionIds,
          currentIndex,
        },
      );
    } else {
      // All executions deleted, proceed to audit log cleanup
      await ctx.scheduler.runAfter(
        0,
        internal.wf_definitions.mutations.batchDeleteWorkflowAuditLogs,
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
        internal.wf_definitions.mutations.batchDeleteWorkflowAuditLogs,
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
          internal.wf_definitions.mutations.batchDeleteWorkflowExecutions,
          {
            wfDefinitionIds,
            currentIndex: currentIndex + 1,
          },
        );
      }
    }
  },
});

import { v } from 'convex/values';

import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import type { WorkflowType } from '../workflow_engine/types/workflow';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { narrowStringUnion } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { createDebugLog } from '../lib/debug_log';
import {
  toConvexJsonValue,
  toConvexJsonValues,
} from '../lib/type_cast_helpers';
import { workflowManagers } from '../workflow_engine/engine';
import { loadFileWorkflow } from '../workflow_engine/helpers/engine/load_file_workflow';
import {
  safeShardIndex,
  getShardIndex,
} from '../workflow_engine/helpers/engine/shard';
import { cleanupExecutionStorage as cleanupExecutionStorageHandler } from '../workflows/executions/cleanup_execution_storage';
import { completeExecution as completeExecutionHandler } from '../workflows/executions/complete_execution';
import { deleteStorageBlob as deleteStorageBlobHandler } from '../workflows/executions/delete_storage_blob';
import { failExecution as failExecutionHandler } from '../workflows/executions/fail_execution';
import { persistExecutionOutput as persistExecutionOutputHandler } from '../workflows/executions/persist_execution_output';
import { updateExecutionStatus as updateExecutionStatusHandler } from '../workflows/executions/update_execution_status';
import { updateExecutionVariables as updateExecutionVariablesHandler } from '../workflows/executions/update_execution_variables';
import { executionStatusValidator } from '../workflows/executions/validators';
import {
  failExecution as failExecutionHelper,
  updateExecutionMetadata,
} from '../workflows/helpers';

export const deleteStorageBlob = internalMutation({
  args: {
    storageId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await deleteStorageBlobHandler(ctx, args);
  },
});

export const cleanupExecutionStorage = internalMutation({
  args: {
    executionId: v.id('wfExecutions'),
    variablesStorageId: v.optional(v.id('_storage')),
    outputStorageId: v.optional(v.id('_storage')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await cleanupExecutionStorageHandler(ctx, args);
  },
});

export const failExecution = internalMutation({
  args: {
    executionId: v.id('wfExecutions'),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await failExecutionHandler(ctx, args);
  },
});

export const completeExecution = internalMutation({
  args: {
    executionId: v.id('wfExecutions'),
    output: jsonValueValidator,
    outputStorageId: v.optional(v.id('_storage')),
    variablesSerialized: v.optional(v.string()),
    variablesStorageId: v.optional(v.id('_storage')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await completeExecutionHandler(ctx, args);
  },
});

export const updateExecutionStatus = internalMutation({
  args: {
    executionId: v.id('wfExecutions'),
    status: executionStatusValidator,
    currentStepSlug: v.optional(v.string()),
    currentStepName: v.optional(v.string()),
    loopProgress: v.optional(
      v.union(v.object({ current: v.number(), total: v.number() }), v.null()),
    ),
    waitingFor: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await updateExecutionStatusHandler(ctx, args);
  },
});

export const updateExecutionVariables = internalMutation({
  args: {
    executionId: v.id('wfExecutions'),
    variablesSerialized: v.optional(v.string()),
    variablesStorageId: v.optional(v.id('_storage')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await updateExecutionVariablesHandler(ctx, args);
  },
});

export const persistExecutionOutput = internalMutation({
  args: {
    executionId: v.id('wfExecutions'),
    output: jsonValueValidator,
    outputStorageId: v.optional(v.id('_storage')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await persistExecutionOutputHandler(ctx, args);
  },
});

const debugLogFile = createDebugLog('DEBUG_WORKFLOW', '[Workflow:File]');

const DYNAMIC_WORKFLOW_REFS = [
  internal.workflow_engine.engine.dynamicWorkflow,
  internal.workflow_engine.engine.dynamicWorkflow1,
  internal.workflow_engine.engine.dynamicWorkflow2,
  internal.workflow_engine.engine.dynamicWorkflow3,
] as const;

/**
 * Start a workflow execution from a pre-loaded file-based workflow config.
 * Called by the startWorkflowFromFile action after reading the JSON file.
 *
 * Bypasses loadDatabaseWorkflow — config is already loaded from the JSON file.
 * Creates the execution record and starts the workflow manager directly.
 */
export const startWorkflowFromFileConfig = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    workflowConfig: v.any(),
    input: v.optional(jsonValueValidator),
    triggeredBy: v.string(),
    triggerData: v.optional(jsonValueValidator),
    userId: v.optional(v.string()),
  },
  returns: v.id('wfExecutions'),
  handler: async (ctx, args) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated by action caller via Zod
    const config = args.workflowConfig as WorkflowJsonConfig;

    let workflowData;
    try {
      workflowData = loadFileWorkflow(
        config,
        args.workflowSlug,
        args.organizationId,
      );
    } catch (error) {
      throw new Error(
        `Failed to load workflow ${args.workflowSlug}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    const definition = workflowData.definition;

    debugLogFile('Creating execution record', {
      workflowSlug: args.workflowSlug,
      workflowName: definition.name,
    });

    // Create execution record with pre-loaded config snapshots
    const executionId = await ctx.db.insert('wfExecutions', {
      organizationId: args.organizationId,
      wfDefinitionId: args.workflowSlug,
      workflowSlug: args.workflowSlug,
      status: 'pending',
      currentStepSlug: '',
      input: args.input || {},
      variables: '{}',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      triggeredBy: args.triggeredBy,
      triggerData: args.triggerData,
      userId: args.userId,
      metadata: '{}',
      workflowConfig: workflowData.workflowConfigJson,
      stepsConfig: JSON.stringify(workflowData.stepsConfigMap),
    });

    const shardIndex = getShardIndex(executionId);
    await ctx.db.patch(executionId, { shardIndex, status: 'running' });
    const workflowManager = workflowManagers[shardIndex];

    // Start workflow engine directly (bypassing executeWorkflowStart / loadDatabaseWorkflow)
    const workflowType: WorkflowType =
      narrowStringUnion(definition.workflowType ?? 'predefined', [
        'predefined',
      ] as const) || 'predefined';

    debugLogFile('Starting workflow via WorkflowManager', {
      executionId,
      workflowType,
    });

    try {
      const dynamicWorkflowRef =
        DYNAMIC_WORKFLOW_REFS[safeShardIndex(shardIndex)];
      const componentWorkflowId = await workflowManager.start(
        ctx,
        dynamicWorkflowRef,
        {
          organizationId: args.organizationId,
          executionId,
          workflowDefinition: toConvexJsonValue(definition),
          steps: toConvexJsonValues(workflowData.steps),
          input: toConvexJsonValue(args.input || {}),
          triggeredBy: args.triggeredBy,
          triggerData: toConvexJsonValue(args.triggerData || {}),
        },
        {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our onComplete handler is compatible at runtime
          onComplete: internal.workflow_engine.internal_mutations
            .onWorkflowComplete as NonNullable<
            Parameters<typeof workflowManager.start>[3]
          >['onComplete'],
          context: { executionId },
        },
      );

      await ctx.db.patch(executionId, { componentWorkflowId });
      await updateExecutionMetadata(ctx, {
        executionId,
        metadata: { componentWorkflowIds: [componentWorkflowId] },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await failExecutionHelper(ctx, {
        executionId,
        error: `Failed to start workflow: ${errorMessage}`,
      });
    }

    return executionId;
  },
});

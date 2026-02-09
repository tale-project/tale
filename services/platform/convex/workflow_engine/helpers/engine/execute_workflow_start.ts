/**
 * Execute workflow start - internal workflow startup implementation
 *
 * This function is called to start a workflow,
 * preventing deep nesting in the mutation response logLines.
 *
 * It updates a pre-created execution record and starts the workflow engine.
 * Supports both database-backed and inline workflows.
 */

import type { WorkflowManager } from '@convex-dev/workflow';

import { Infer } from 'convex/values';

import type { Doc } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';
import type { WorkflowType } from '../../types/workflow';

import { jsonValueValidator } from '../../../../lib/shared/schemas/utils/json-value';
import { internal } from '../../../_generated/api';
import {
  failExecution,
  updateExecutionMetadata,
} from '../../../workflows/helpers';
import { loadDatabaseWorkflow } from './load_database_workflow';

type ConvexJsonValue = Infer<typeof jsonValueValidator>;

import { createDebugLog } from '../../../lib/debug_log';
import { safeShardIndex } from './shard';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export type ExecuteWorkflowStartArgs = {
  executionId: Doc<'wfExecutions'>['_id'];
  organizationId: string;
  wfDefinitionId: Doc<'wfDefinitions'>['_id'];
  input?: unknown;
  triggeredBy: string;
  triggerData?: unknown;
  workflowManager: WorkflowManager;
  shardIndex?: number;
};

const DYNAMIC_WORKFLOW_REFS = [
  internal.workflow_engine.engine.dynamicWorkflow,
  internal.workflow_engine.engine.dynamicWorkflow1,
  internal.workflow_engine.engine.dynamicWorkflow2,
  internal.workflow_engine.engine.dynamicWorkflow3,
] as const;

export async function executeWorkflowStart(
  ctx: MutationCtx,
  args: ExecuteWorkflowStartArgs,
): Promise<void> {
  debugLog('executeWorkflowStart Starting workflow execution', {
    executionId: args.executionId,
    wfDefinitionId: args.wfDefinitionId,
  });

  // Step 1: Load workflow data from database
  //
  // CRITICAL: This try-catch is necessary and cannot be removed because:
  // 1. The execution record is created in 'pending' status before this function runs
  // 2. If workflow loading fails (invalid config, missing definition, validation errors),
  //    the execution would remain stuck in 'pending' status forever
  // 3. We MUST mark the execution as 'failed' to provide proper feedback to users
  // 4. We catch the error, mark execution as failed, and return early (no throw)
  //    to ensure the database update commits successfully
  //
  // This is an exception to our "no try-catch" policy because we need to update
  // database state (execution status) and prevent the mutation from rolling back.
  let workflowData;
  try {
    workflowData = await loadDatabaseWorkflow(ctx, args.wfDefinitionId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[executeWorkflowStart] Failed to load workflow data', {
      executionId: args.executionId,
      error: errorMessage,
    });

    // Mark execution as failed and return early
    // Do NOT throw - that would rollback the mutation and the status update
    await failExecution(ctx, {
      executionId: args.executionId,
      error: `Failed to load workflow data: ${errorMessage}`,
    });

    return;
  }

  // Extract common fields from definition (works for both inline and database workflows)
  const definition = workflowData.definition as Doc<'wfDefinitions'>;

  debugLog('executeWorkflowStart Workflow data loaded', {
    workflowName: definition.name,
    stepsCount: workflowData.steps.length,
  });

  // Step 2: Update execution record with workflow data
  // If the requested wfDefinitionId was archived/inactive and we fell back to an active version,
  // align the execution's wfDefinitionId to the effective definition for accurate auditability.
  const executionPatch: Record<string, unknown> = {
    status: 'running',
    updatedAt: Date.now(),
    workflowConfig: workflowData.workflowConfigJson,
    stepsConfig: JSON.stringify(workflowData.stepsConfigMap),
  };

  // If the requested wfDefinitionId was archived/inactive and we fell back to an
  // active version, align the execution's wfDefinitionId to the effective
  // definition for accurate auditability.
  if (definition._id !== args.wfDefinitionId) {
    executionPatch.wfDefinitionId = definition._id;
    debugLog(
      'executeWorkflowStart Switched to active workflow version for execution',
      {
        requestedId: args.wfDefinitionId,
        effectiveId: definition._id,
        status: definition.status,
      },
    );
  }

  await ctx.db.patch(args.executionId, executionPatch);

  // Step 3: Determine workflow type for logging (defaults to 'predefined')
  const workflowType: WorkflowType =
    (definition.workflowType as WorkflowType | undefined) || 'predefined';

  // Step 4: Start workflow via WorkflowManager
  debugLog('executeWorkflowStart Starting workflow via WorkflowManager', {
    workflowType,
  });

  const dynamicWorkflowRef =
    DYNAMIC_WORKFLOW_REFS[safeShardIndex(args.shardIndex)];
  const componentWorkflowId = await args.workflowManager.start(
    ctx,
    dynamicWorkflowRef,
    {
      organizationId: args.organizationId,
      executionId: args.executionId,
      workflowDefinition: definition as unknown as ConvexJsonValue,
      steps: workflowData.steps as unknown as ConvexJsonValue[],
      input: (args.input || {}) as ConvexJsonValue,
      triggeredBy: args.triggeredBy,
      triggerData: (args.triggerData || {}) as ConvexJsonValue,
    },
    {
      // Type assertion: our onComplete handler accepts jsonValueValidator which is compatible
      // with the workflow component's OnCompleteArgs at runtime, but not at compile time
      onComplete: internal.workflow_engine.internal_mutations
        .onWorkflowComplete as unknown as Parameters<
        typeof args.workflowManager.start
      >[3]['onComplete'],
      context: { executionId: args.executionId },
    },
  );

  debugLog('executeWorkflowStart Workflow started successfully', {
    componentWorkflowId,
  });

  // Step 5: Store workflow mapping and metadata
  await ctx.db.patch(args.executionId, { componentWorkflowId });

  await updateExecutionMetadata(ctx, {
    executionId: args.executionId,
    metadata: {
      componentWorkflowIds: [componentWorkflowId],
    },
  });

  debugLog('executeWorkflowStart Workflow startup complete');
}

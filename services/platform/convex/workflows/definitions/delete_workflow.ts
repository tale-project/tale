/**
 * Delete workflow
 *
 * Uses scheduled mutations to delete executions in batches across separate
 * mutation contexts. Cleanup of component workflows is done asynchronously
 * to avoid hitting Convex's 4096 read operations limit.
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { WorkflowId } from '@convex-dev/workflow';
import { internal } from '../../_generated/api';
import { workflowManager } from '../../workflow_engine/engine';

const EXECUTION_BATCH_SIZE = 100;

export async function deleteWorkflow(
  ctx: MutationCtx,
  wfDefinitionId: Id<'wfDefinitions'>,
): Promise<null> {
  const workflow = await ctx.db.get(wfDefinitionId);
  if (!workflow) {
    return null;
  }

  const rootVersionId = workflow.rootVersionId;

  // Collect all version IDs to delete (this is a small list of just IDs)
  const versionIds: Array<Id<'wfDefinitions'>> = [];

  if (rootVersionId && rootVersionId === workflow._id) {
    // Root version: collect all versions in the family
    for await (const version of ctx.db
      .query('wfDefinitions')
      .withIndex('by_rootVersionId', (q) =>
        q.eq('rootVersionId', rootVersionId),
      )) {
      versionIds.push(version._id);
    }
  } else {
    // Single workflow deletion
    versionIds.push(wfDefinitionId);
  }

  // Schedule the first batch of execution deletions
  await ctx.scheduler.runAfter(
    0,
    internal.wf_definitions.mutations.batchDeleteWorkflowExecutions,
    {
      wfDefinitionIds: versionIds,
      currentIndex: 0,
    },
  );

  return null;
}

export async function cancelAndDeleteExecutionsBatch(
  ctx: MutationCtx,
  wfDefinitionId: Id<'wfDefinitions'>,
): Promise<{ hasMore: boolean }> {
  let processedCount = 0;
  const componentWorkflowIdsToCleanup: string[] = [];

  for await (const execution of ctx.db
    .query('wfExecutions')
    .withIndex('by_definition', (q) => q.eq('wfDefinitionId', wfDefinitionId))) {
    if (execution.componentWorkflowId) {
      const componentWorkflowId =
        execution.componentWorkflowId as unknown as WorkflowId;
      const isInProgress =
        execution.status !== 'completed' && execution.status !== 'failed';

      if (isInProgress) {
        // Cancel any in-progress underlying component workflow.
        await workflowManager.cancel(ctx, componentWorkflowId);
      }

      // Collect for async cleanup (avoid inline cleanup() to stay under read limit)
      componentWorkflowIdsToCleanup.push(execution.componentWorkflowId);
    }

    await ctx.db.delete(execution._id);
    processedCount++;

    if (processedCount >= EXECUTION_BATCH_SIZE) {
      await scheduleCleanupBatch(ctx, componentWorkflowIdsToCleanup);
      return { hasMore: true };
    }
  }

  if (componentWorkflowIdsToCleanup.length > 0) {
    await scheduleCleanupBatch(ctx, componentWorkflowIdsToCleanup);
  }

  return { hasMore: false };
}

async function scheduleCleanupBatch(
  ctx: MutationCtx,
  componentWorkflowIds: string[],
): Promise<void> {
  for (const id of componentWorkflowIds) {
    await ctx.scheduler.runAfter(
      10_000,
      internal.workflow_engine.engine.cleanupComponentWorkflow,
      { workflowId: id as unknown as WorkflowId },
    );
  }
}

export async function deleteStepsAndDefinition(
  ctx: MutationCtx,
  wfDefinitionId: Id<'wfDefinitions'>,
): Promise<void> {
  // Collect all step IDs first (steps are typically few and small)
  const stepIds: Array<Id<'wfStepDefs'>> = [];
  for await (const step of ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) => q.eq('wfDefinitionId', wfDefinitionId))) {
    stepIds.push(step._id);
  }

  // Delete all steps in parallel
  await Promise.all(stepIds.map((id) => ctx.db.delete(id)));

  // Delete the workflow definition
  await ctx.db.delete(wfDefinitionId);
}

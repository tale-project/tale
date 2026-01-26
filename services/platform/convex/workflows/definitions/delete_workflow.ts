/**
 * Delete workflow
 *
 * Uses scheduled mutations to delete executions in batches across separate
 * mutation contexts, avoiding Convex's 16MB bytes-read limit.
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

        // Schedule cleanup after a short delay to avoid racing with the
        // workflow engine's own cancellation/onComplete logic, which still
        // expects the journal entry to exist for a brief period.
        await ctx.scheduler.runAfter(
          10_000,
          internal.workflow_engine.engine.cleanupComponentWorkflow,
          {
            workflowId: componentWorkflowId,
          },
        );
      } else {
        // For completed/failed workflows, it's safe to fully remove the
        // underlying component workflow so its journal/state is removed from
        // the workflow component tables.
        await workflowManager.cleanup(ctx, componentWorkflowId);
      }
    }

    // Delete the execution record regardless of status.
    await ctx.db.delete(execution._id);
    processedCount++;

    if (processedCount >= EXECUTION_BATCH_SIZE) {
      return { hasMore: true };
    }
  }

  return { hasMore: false };
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

/**
 * Delete workflow
 *
 * Uses scheduled mutations to delete executions, audit logs, steps, and the
 * definition in batches across separate mutation contexts. Each phase runs
 * in its own batch loop to stay under Convex's 16MB byte-read limit.
 *
 * Flow per definition:
 * 1. Cancel & delete executions (batch size: 10, cancel is expensive)
 * 2. Delete step audit logs (batch size: 500, delete-only)
 * 3. Delete step definitions + workflow definition (inline)
 *
 * Cleanup of component workflows is scheduled asynchronously to avoid
 * hitting read/operation limits.
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { WorkflowId } from '@convex-dev/workflow';
import { internal } from '../../_generated/api';
import { workflowManagers } from '../../workflow_engine/engine';

const EXECUTION_BATCH_SIZE = 10;
const AUDIT_LOG_BATCH_SIZE = 500;

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
    internal.wf_definitions.internal_mutations.batchDeleteWorkflowExecutions,
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
  const cleanupEntries: { workflowId: string; shardIndex: number }[] = [];

  for await (const execution of ctx.db
    .query('wfExecutions')
    .withIndex('by_definition', (q) => q.eq('wfDefinitionId', wfDefinitionId))) {
    const shardIndex = execution.shardIndex ?? 0;

    if (execution.componentWorkflowId) {
      const componentWorkflowId =
        execution.componentWorkflowId as unknown as WorkflowId;
      const isInProgress =
        execution.status !== 'completed' && execution.status !== 'failed';

      if (isInProgress) {
        const manager = workflowManagers[shardIndex];
        await manager.cancel(ctx, componentWorkflowId);
      }

      cleanupEntries.push({
        workflowId: execution.componentWorkflowId,
        shardIndex,
      });
    }

    await ctx.db.delete(execution._id);
    processedCount++;

    if (processedCount >= EXECUTION_BATCH_SIZE) {
      await scheduleCleanupBatch(ctx, cleanupEntries);
      return { hasMore: true };
    }
  }

  if (cleanupEntries.length > 0) {
    await scheduleCleanupBatch(ctx, cleanupEntries);
  }

  return { hasMore: false };
}

async function scheduleCleanupBatch(
  ctx: MutationCtx,
  entries: { workflowId: string; shardIndex: number }[],
): Promise<void> {
  for (const { workflowId, shardIndex } of entries) {
    await ctx.scheduler.runAfter(
      10_000,
      internal.workflow_engine.internal_mutations.cleanupComponentWorkflow,
      { workflowId: workflowId as unknown as WorkflowId, shardIndex },
    );
  }
}

export async function deleteAuditLogsBatch(
  ctx: MutationCtx,
  wfDefinitionId: Id<'wfDefinitions'>,
): Promise<{ hasMore: boolean }> {
  let deletedCount = 0;

  for await (const log of ctx.db
    .query('wfStepAuditLogs')
    .withIndex('by_workflow', (q) => q.eq('wfDefinitionId', wfDefinitionId))) {
    await ctx.db.delete(log._id);
    deletedCount++;

    if (deletedCount >= AUDIT_LOG_BATCH_SIZE) {
      return { hasMore: true };
    }
  }

  return { hasMore: false };
}

export async function deleteStepsAndDefinition(
  ctx: MutationCtx,
  wfDefinitionId: Id<'wfDefinitions'>,
): Promise<void> {
  for await (const step of ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) => q.eq('wfDefinitionId', wfDefinitionId))) {
    await ctx.db.delete(step._id);
  }

  await ctx.db.delete(wfDefinitionId);
}

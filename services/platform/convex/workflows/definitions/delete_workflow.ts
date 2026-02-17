/**
 * Delete workflow
 *
 * Immediately deletes all wfDefinition records so they vanish from queries,
 * then schedules batched cleanup of related data (executions, audit logs,
 * step definitions) across separate mutation contexts to stay under Convex's
 * 16MB byte-read limit.
 *
 * Flow:
 * 1. Delete all wfDefinition records synchronously (small set)
 * 2. Schedule async cleanup per definition:
 *    a. Cancel & delete executions (batch size: 10, cancel is expensive)
 *    b. Delete step audit logs (batch size: 500, delete-only)
 *    c. Delete step definitions (inline)
 *
 * Cleanup of component workflows is scheduled asynchronously to avoid
 * hitting read/operation limits.
 */

import type { WorkflowId } from '@convex-dev/workflow';

import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

import { internal } from '../../_generated/api';
import { workflowManagers } from '../../workflow_engine/engine';
import { safeShardIndex } from '../../workflow_engine/helpers/engine/shard';

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

  // Delete all wfDefinition records immediately so they vanish from queries.
  // Safe before execution cleanup: in-flight executions store stepsConfig and
  // workflowConfig in the wfExecution record at start time and never re-query
  // wfDefinitions during step execution (see loadAndValidateExecution).
  for (const id of versionIds) {
    await ctx.db.delete(id);
  }

  // Schedule async cleanup of related data (executions, audit logs, steps)
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
    .withIndex('by_definition', (q) =>
      q.eq('wfDefinitionId', wfDefinitionId),
    )) {
    const shardIndex = safeShardIndex(execution.shardIndex);

    if (execution.componentWorkflowId) {
      const componentWorkflowId =
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- third-party type
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
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- third-party type
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

export async function deleteSteps(
  ctx: MutationCtx,
  wfDefinitionId: Id<'wfDefinitions'>,
): Promise<void> {
  for await (const step of ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) =>
      q.eq('wfDefinitionId', wfDefinitionId),
    )) {
    await ctx.db.delete(step._id);
  }
}

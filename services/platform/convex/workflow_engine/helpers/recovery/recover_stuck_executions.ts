/**
 * Recovery mechanism for stuck workflow executions.
 *
 * Finds executions stuck in 'running' or 'pending' status for longer than
 * the maximum allowed duration, marks them as failed, and cancels the
 * underlying workflow component execution to stop the workpool from
 * continuing to process steps.
 */

import type { WorkflowId, WorkflowManager } from '@convex-dev/workflow';

import type { Doc } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';

import { internal } from '../../../_generated/api';
import { STORAGE_RETENTION_MS } from '../../../workflows/executions/cleanup_execution_storage';
import { safeShardIndex } from '../engine/shard';

const DEFAULT_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours
const BATCH_SIZE = 50;
const CLEANUP_DELAY_MS = 10_000;

/**
 * Extract per-workflow timeout from the execution's workflowConfig JSON string.
 * Falls back to DEFAULT_TIMEOUT_MS if not configured or unparseable.
 */
function getTimeoutMs(execution: Doc<'wfExecutions'>): number {
  if (!execution.workflowConfig) return DEFAULT_TIMEOUT_MS;

  try {
    const parsed = JSON.parse(execution.workflowConfig);
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.config &&
      typeof parsed.config.timeout === 'number' &&
      parsed.config.timeout > 0
    ) {
      return parsed.config.timeout;
    }
  } catch (error) {
    console.error(
      `[StuckRecovery] Failed to parse workflowConfig for execution ${execution._id}:`,
      error,
    );
  }

  return DEFAULT_TIMEOUT_MS;
}

/**
 * Cancel the workflow component execution and schedule cleanup.
 */
async function cancelComponentWorkflow(
  ctx: MutationCtx,
  execution: Doc<'wfExecutions'>,
  managers: WorkflowManager[],
): Promise<void> {
  if (!execution.componentWorkflowId) return;

  const manager = managers[safeShardIndex(execution.shardIndex)];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- componentWorkflowId is stored as string but the component API requires WorkflowId branded type
  const workflowId = execution.componentWorkflowId as unknown as WorkflowId;

  await manager.cancel(ctx, workflowId);
  await ctx.scheduler.runAfter(
    CLEANUP_DELAY_MS,
    internal.workflow_engine.internal_mutations.cleanupComponentWorkflow,
    { workflowId, shardIndex: safeShardIndex(execution.shardIndex) },
  );
}

async function scheduleStorageCleanup(
  ctx: MutationCtx,
  execution: Doc<'wfExecutions'>,
): Promise<void> {
  const { variablesStorageId, outputStorageId } = execution;
  if (variablesStorageId || outputStorageId) {
    await ctx.scheduler.runAfter(
      STORAGE_RETENTION_MS,
      internal.wf_executions.internal_mutations.cleanupExecutionStorage,
      { executionId: execution._id, variablesStorageId, outputStorageId },
    );
  }
}

export async function recoverStuckExecutions(
  ctx: MutationCtx,
  managers: WorkflowManager[],
): Promise<{ recovered: number }> {
  let recovered = 0;

  for await (const execution of ctx.db
    .query('wfExecutions')
    .withIndex('by_status', (q) => q.eq('status', 'running'))) {
    if (recovered >= BATCH_SIZE) break;

    const timeoutMs = getTimeoutMs(execution);
    const cutoffMs = Date.now() - timeoutMs;

    if (execution.updatedAt < cutoffMs) {
      await cancelComponentWorkflow(ctx, execution, managers);
      await ctx.db.patch(execution._id, {
        status: 'failed',
        updatedAt: Date.now(),
        metadata: JSON.stringify({
          error: `Execution timed out after ${timeoutMs / 60_000} minutes (stuck recovery)`,
          recoveredAt: Date.now(),
          previousStatus: 'running',
        }),
      });
      await scheduleStorageCleanup(ctx, execution);
      recovered++;
    }
  }

  for await (const execution of ctx.db
    .query('wfExecutions')
    .withIndex('by_status', (q) => q.eq('status', 'pending'))) {
    if (recovered >= BATCH_SIZE) break;

    const timeoutMs = getTimeoutMs(execution);
    const cutoffMs = Date.now() - timeoutMs;

    if (execution.updatedAt < cutoffMs) {
      await cancelComponentWorkflow(ctx, execution, managers);
      await ctx.db.patch(execution._id, {
        status: 'failed',
        updatedAt: Date.now(),
        metadata: JSON.stringify({
          error: `Execution timed out in pending state after ${timeoutMs / 60_000} minutes (stuck recovery)`,
          recoveredAt: Date.now(),
          previousStatus: 'pending',
        }),
      });
      await scheduleStorageCleanup(ctx, execution);
      recovered++;
    }
  }

  return { recovered };
}

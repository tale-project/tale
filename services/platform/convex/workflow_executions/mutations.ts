import { saveMessage } from '@convex-dev/agent';
import type { WorkflowId } from '@convex-dev/workflow';
import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-utils';
import { components, internal } from '../_generated/api';
import { mutationWithRLS } from '../lib/rls';
import { toId } from '../lib/type_cast_helpers';
import { workflowManagers } from '../workflow_engine/engine';
import { safeShardIndex } from '../workflow_engine/helpers/engine/shard';
import { STORAGE_RETENTION_MS } from '../workflows/executions/cleanup_execution_storage';
import { resumeDebugStep as resumeDebugStepHandler } from '../workflows/executions/resume_debug_step';
import { mergeExecutionMetadata } from '../workflows/executions/update_execution_metadata';

const CLEANUP_DELAY_MS = 10_000;

export const resumeDebugStep = mutationWithRLS({
  args: {
    executionId: v.id('wfExecutions'),
    action: v.union(v.literal('step'), v.literal('continue')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await resumeDebugStepHandler(ctx, args);
  },
});

export const cancelExecution = mutationWithRLS({
  args: {
    executionId: v.id('wfExecutions'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution) {
      throw new Error('Execution not found');
    }

    if (execution.status !== 'running' && execution.status !== 'pending') {
      throw new Error(
        `Cannot cancel execution with status "${execution.status}"`,
      );
    }

    // Cancel the underlying component workflow
    if (execution.componentWorkflowId) {
      const shardIdx = safeShardIndex(execution.shardIndex);
      const manager = workflowManagers[shardIdx];
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- componentWorkflowId stored as string, WorkflowId is a branded type
      const workflowId = execution.componentWorkflowId as unknown as WorkflowId;

      await manager.cancel(ctx, workflowId);
      await ctx.scheduler.runAfter(
        CLEANUP_DELAY_MS,
        internal.workflow_engine.internal_mutations.cleanupComponentWorkflow,
        { workflowId, shardIndex: shardIdx },
      );
    }

    // Tear down the execution's sandbox NOW. Cancelling the durable workflow
    // above stops re-entry but never touches the sandbox layer, so any in-flight
    // ephemeral `workflow_run` session would keep its container running (agent
    // burning budget) and keep holding a per-org concurrency slot until the TTL
    // reaper — wedging the org's capacity queue after a Stop. Scheduled (not
    // awaited): it calls the spawner over HTTP, and a teardown failure must not
    // fail the user's Stop. No-op when the run held no sandbox.
    await ctx.scheduler.runAfter(
      0,
      internal.node_only.sandbox.workflow_sandbox_exec
        .cancelSandboxForExecution,
      {
        organizationId: execution.organizationId,
        executionId: args.executionId,
      },
    );

    await ctx.db.patch(args.executionId, {
      status: 'failed',
      error: 'Cancelled by user',
      errorCode: 'canceled',
      completedAt: execution.completedAt ?? Date.now(),
      updatedAt: Date.now(),
      metadata: mergeExecutionMetadata(execution.metadata, {
        error: 'Cancelled by user',
        cancelledAt: Date.now(),
      }),
    });

    // Schedule deferred cleanup of storage blobs after 30 days
    const variablesStorageId = execution.variablesStorageId;
    const outputStorageId = execution.outputStorageId;
    if (variablesStorageId || outputStorageId) {
      await ctx.scheduler.runAfter(
        STORAGE_RETENTION_MS,
        internal.workflow_executions.internal_mutations.cleanupExecutionStorage,
        { executionId: args.executionId, variablesStorageId, outputStorageId },
      );
    }

    // Write system message to thread so the AI knows this was user-initiated
    const triggerData = isRecord(execution.triggerData)
      ? execution.triggerData
      : null;
    const approvalIdStr = triggerData
      ? getString(triggerData, 'approvalId')
      : undefined;
    if (approvalIdStr) {
      try {
        const approval = await ctx.db.get(toId<'approvals'>(approvalIdStr));
        if (approval?.threadId) {
          await saveMessage(ctx, components.agent, {
            threadId: approval.threadId,
            message: {
              role: 'system',
              content: `[WORKFLOW_CANCELLED]\nWorkflow "${execution.workflowSlug ?? 'unknown'}" was stopped.`,
            },
          });
        }
      } catch (error) {
        // Non-critical: system message failure should not block cancellation
        console.warn(
          `cancelExecution: failed to post cancellation message for execution ${args.executionId}:`,
          error,
        );
      }
    }

    return null;
  },
});

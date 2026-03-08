import type { WorkflowId } from '@convex-dev/workflow';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { mutationWithRLS } from '../lib/rls';
import { workflowManagers } from '../workflow_engine/engine';
import { safeShardIndex } from '../workflow_engine/helpers/engine/shard';

const CLEANUP_DELAY_MS = 10_000;

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

    await ctx.db.patch(args.executionId, {
      status: 'failed',
      updatedAt: Date.now(),
      metadata: JSON.stringify({
        error: 'Cancelled by user',
        cancelledAt: Date.now(),
      }),
    });

    return null;
  },
});

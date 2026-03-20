import type { WorkflowId } from '@convex-dev/workflow';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember, mutationWithRLS } from '../lib/rls';
import { jsonValueValidator } from '../lib/validators/json';
import { workflowManagers } from '../workflow_engine/engine';
import { safeShardIndex } from '../workflow_engine/helpers/engine/shard';
import { handleStartWorkflow } from '../workflow_engine/helpers/engine/start_workflow_handler';
import { STORAGE_RETENTION_MS } from '../workflows/executions/cleanup_execution_storage';

const CLEANUP_DELAY_MS = 10_000;

export const startWorkflow = mutation({
  args: {
    organizationId: v.string(),
    wfDefinitionId: v.id('wfDefinitions'),
    input: v.optional(jsonValueValidator),
    triggeredBy: v.string(),
    triggerData: v.optional(jsonValueValidator),
  },
  returns: v.id('wfExecutions'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    return await handleStartWorkflow(ctx, args, workflowManagers);
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

    await ctx.db.patch(args.executionId, {
      status: 'failed',
      updatedAt: Date.now(),
      metadata: JSON.stringify({
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
        internal.wf_executions.internal_mutations.cleanupExecutionStorage,
        { executionId: args.executionId, variablesStorageId, outputStorageId },
      );
    }

    return null;
  },
});

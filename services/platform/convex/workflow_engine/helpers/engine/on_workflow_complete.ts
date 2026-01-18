/**
 * Workflow completion hook business logic
 *
 * Handles the logic when a workflow completes execution.
 * Mirrors final status to wfExecutions table.
 */

import type { MutationCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import type { Id, Doc } from '../../../_generated/dataModel';
import type { ComponentRunResult } from '../../types';

export async function handleWorkflowComplete(
  ctx: MutationCtx,
  args: {
    workflowId: string;
    context: unknown;
    result: unknown;
  },
): Promise<void> {
  const ctxAny = args.context as { executionId?: Id<'wfExecutions'> } | null;
  let exec: Doc<'wfExecutions'> | null = null;
  if (ctxAny?.executionId) {
    exec = await ctx.db.get(ctxAny.executionId as Id<'wfExecutions'>);
  }
  if (!exec) {
    exec = await ctx.db
      .query('wfExecutions')
      .withIndex('by_component_workflow', (q) =>
        q.eq('componentWorkflowId', args.workflowId as unknown as string),
      )
      .first();
  }
  if (!exec) return;

  const result = args.result as ComponentRunResult;
  const kind = result?.kind;
  if (kind === 'success') {
    await ctx.runMutation(internal.wf_executions.mutations.completeExecution, {
      executionId: exec._id as Id<'wfExecutions'>,
      output: result.returnValue,
    });
  } else if (kind === 'failed') {
    await ctx.runMutation(internal.wf_executions.mutations.failExecution, {
      executionId: exec._id as Id<'wfExecutions'>,
      error: result.error || 'failed',
    });
  } else if (kind === 'canceled') {
    await ctx.runMutation(internal.wf_executions.mutations.updateExecutionStatus, {
      executionId: exec._id as Id<'wfExecutions'>,
      status: 'failed',
      error: 'canceled',
    });
  }
}

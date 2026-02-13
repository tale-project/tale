/**
 * Workflow completion hook business logic
 *
 * Handles the logic when a workflow completes execution.
 * Mirrors final status to wfExecutions table.
 */

import type { Id, Doc } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';
import type { ComponentRunResult } from '../../types';

import { internal } from '../../../_generated/api';
import { toConvexJsonValue, toId } from '../../../lib/type_cast_helpers';
import { emitEvent } from '../../../workflows/triggers/emit_event';

export async function handleWorkflowComplete(
  ctx: MutationCtx,
  args: {
    workflowId: string;
    context: unknown;
    result: unknown;
  },
): Promise<void> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
  const ctxAny = args.context as { executionId?: Id<'wfExecutions'> } | null;
  let exec: Doc<'wfExecutions'> | null = null;
  if (ctxAny?.executionId) {
    exec = await ctx.db.get(ctxAny.executionId);
  }
  if (!exec) {
    exec = await ctx.db
      .query('wfExecutions')
      .withIndex('by_component_workflow', (q) =>
        q.eq('componentWorkflowId', args.workflowId),
      )
      .first();
  }
  if (!exec) return;

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
  const result = args.result as ComponentRunResult;
  const kind = result?.kind;
  if (kind === 'success') {
    await ctx.runMutation(
      internal.wf_executions.internal_mutations.completeExecution,
      {
        executionId: toId<'wfExecutions'>(exec._id),
        output: toConvexJsonValue(result.returnValue),
      },
    );
    await emitEvent(ctx, {
      organizationId: exec.organizationId,
      eventType: 'workflow.completed',
      eventData: { execution: exec },
    });
  } else if (kind === 'failed') {
    await ctx.runMutation(
      internal.wf_executions.internal_mutations.failExecution,
      {
        executionId: toId<'wfExecutions'>(exec._id),
        error: result.error || 'failed',
      },
    );
  } else if (kind === 'canceled') {
    await ctx.runMutation(
      internal.wf_executions.internal_mutations.updateExecutionStatus,
      {
        executionId: toId<'wfExecutions'>(exec._id),
        status: 'failed',
        error: 'canceled',
      },
    );
  }
}

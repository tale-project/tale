/**
 * Workflow completion hook business logic
 *
 * Handles the logic when a workflow completes execution.
 * Mirrors final status to wfExecutions table.
 */

import type { Doc } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';
import type { ComponentRunResult } from '../../types';

import { isRecord, getString } from '../../../../lib/utils/type-guards';
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
  const ctxRecord = isRecord(args.context) ? args.context : null;
  const executionIdStr = ctxRecord
    ? getString(ctxRecord, 'executionId')
    : undefined;
  let exec: Doc<'wfExecutions'> | null = null;
  if (executionIdStr) {
    exec = await ctx.db.get(toId<'wfExecutions'>(executionIdStr));
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

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- args.result comes from @convex-dev/workflow component callback; shape is ComponentRunResult at runtime
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
    const updatedExec = await ctx.db.get(exec._id);
    if (updatedExec) {
      await emitEvent(ctx, {
        organizationId: updatedExec.organizationId,
        eventType: 'workflow.completed',
        eventData: { execution: updatedExec },
      });
    }
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

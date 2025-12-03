import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { ListApprovalsResult } from './types';

export async function listApprovalsForExecution(
  ctx: ActionCtx,
  params: {
    executionId: Id<'wfExecutions'>;
  },
): Promise<ListApprovalsResult> {
  const approvals = await ctx.runQuery(
    internal.approvals.listApprovalsForExecution,
    {
      executionId: params.executionId,
    },
  );

  return {
    operation: 'list_approvals_for_execution',
    approvals,
    count: approvals.length,
  };
}

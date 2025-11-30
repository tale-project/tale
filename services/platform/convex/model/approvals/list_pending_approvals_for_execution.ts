/**
 * List pending approvals for a specific workflow execution
 */

import { QueryCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { ApprovalItem } from './types';

export async function listPendingApprovalsForExecution(
  ctx: QueryCtx,
  executionId: Id<'wfExecutions'>,
): Promise<Array<ApprovalItem>> {
  const approvals = await ctx.db
    .query('approvals')
    .withIndex('by_execution', (q) => q.eq('wfExecutionId', executionId))
    .order('desc')
    .collect();

  return approvals.filter((a) => a.status === 'pending');
}

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
  const pendingApprovals: Array<ApprovalItem> = [];

  for await (const approval of ctx.db
    .query('approvals')
    .withIndex('by_execution', (q) => q.eq('wfExecutionId', executionId))
    .order('desc')) {
    if (approval.status === 'pending') {
      pendingApprovals.push(approval);
    }
  }

  return pendingApprovals;
}

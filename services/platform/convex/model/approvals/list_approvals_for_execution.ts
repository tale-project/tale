/**
 * List all approvals for a specific workflow execution
 */

import { QueryCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { ApprovalItem } from './types';

export async function listApprovalsForExecution(
  ctx: QueryCtx,
  executionId: Id<'wfExecutions'>,
): Promise<Array<ApprovalItem>> {
  const approvals: Array<ApprovalItem> = [];
  for await (const approval of ctx.db
    .query('approvals')
    .withIndex('by_execution', (q) => q.eq('wfExecutionId', executionId))
    .order('desc')) {
    approvals.push(approval);
  }
  return approvals;
}

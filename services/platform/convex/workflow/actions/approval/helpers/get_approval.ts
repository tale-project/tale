import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { GetApprovalResult } from './types';

export async function getApproval(
  ctx: ActionCtx,
  params: {
    approvalId: Id<'approvals'>;
  },
): Promise<GetApprovalResult> {
  const approval = await ctx.runQuery(internal.approvals.getApprovalById, {
    approvalId: params.approvalId,
  });

  return {
    operation: 'get_approval',
    approval,
  };
}

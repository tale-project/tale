import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { UpdateApprovalStatusResult, ApprovalStatus } from './types';

export async function updateApprovalStatus(
  ctx: ActionCtx,
  params: {
    approvalId: Id<'approvals'>;
    status: ApprovalStatus;
    approvedBy: string;
    comments?: string;
  },
): Promise<UpdateApprovalStatusResult> {
  await ctx.runMutation(internal.approvals.updateApprovalStatus, {
    approvalId: params.approvalId,
    status: params.status,
    approvedBy: params.approvedBy,
    comments: params.comments,
  });

  return {
    operation: 'update_approval_status',
    approvalId: params.approvalId,
    status: params.status,
    success: true,
    timestamp: Date.now(),
  };
}

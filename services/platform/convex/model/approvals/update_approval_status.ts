/**
 * Update approval status
 */

import { MutationCtx } from '../../_generated/server';
import { UpdateApprovalStatusArgs } from './types';

export async function updateApprovalStatus(
  ctx: MutationCtx,
  args: UpdateApprovalStatusArgs,
): Promise<void> {
  const current = await ctx.db.get(args.approvalId);
  if (!current) {
    throw new Error('Approval not found');
  }

  await ctx.db.patch(args.approvalId, {
    status: args.status,
    approvedBy: args.approvedBy,
    reviewedAt: Date.now(),
    metadata: {
      ...(current.metadata as Record<string, unknown>),
      ...(args.comments ? { comments: args.comments } : {}),
    },
  });
}


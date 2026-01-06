/**
 * Update approval status
 */

import { MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';
import { UpdateApprovalStatusArgs } from './types';

export async function updateApprovalStatus(
  ctx: MutationCtx,
  args: UpdateApprovalStatusArgs,
): Promise<void> {
  const current = await ctx.db.get(args.approvalId);
  if (!current) {
    throw new Error('Approval not found');
  }

  // Look up the member to get their display name
  let approverName: string | undefined;
  const memberRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 1 },
    where: [{ field: '_id', value: args.approvedBy, operator: 'eq' }],
  });
  const member = memberRes?.page?.[0];
  if (member) {
    // Get user info for display name
    const userRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: member.userId, operator: 'eq' }],
    });
    const user = userRes?.page?.[0];
    approverName = (user?.name as string) || (user?.email as string);
  }

  await ctx.db.patch(args.approvalId, {
    status: args.status,
    approvedBy: args.approvedBy,
    reviewedAt: Date.now(),
    metadata: {
      ...(current.metadata as Record<string, unknown>),
      ...(args.comments ? { comments: args.comments } : {}),
      ...(approverName ? { approverName } : {}),
    },
  });
}

/**
 * Get approval history for a resource
 */

import { QueryCtx } from '../../_generated/server';
import { ApprovalItem, GetApprovalHistoryArgs } from './types';

export async function getApprovalHistory(
  ctx: QueryCtx,
  args: GetApprovalHistoryArgs,
): Promise<Array<ApprovalItem>> {
  return await ctx.db
    .query('approvals')
    .withIndex('by_resource', (q) =>
      q.eq('resourceType', args.resourceType).eq('resourceId', args.resourceId),
    )
    .order('desc')
    .collect();
}

/**
 * Get pending approval for a resource
 */
export async function getPendingApprovalForResource(
  ctx: QueryCtx,
  args: GetApprovalHistoryArgs,
): Promise<ApprovalItem | null> {
  const approvals = await ctx.db
    .query('approvals')
    .withIndex('by_resourceType_and_resourceId_and_status', (q) =>
      q
        .eq('resourceType', args.resourceType)
        .eq('resourceId', args.resourceId)
        .eq('status', 'pending'),
    )
    .order('desc')
    .take(1);

  // Return the first pending approval (there should only be one)
  return approvals[0] || null;
}

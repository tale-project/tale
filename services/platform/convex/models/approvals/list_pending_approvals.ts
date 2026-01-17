/**
 * List pending approvals for organization
 */

import { QueryCtx } from '../../_generated/server';

import { ApprovalItem, ApprovalResourceType } from './types';

export interface ListPendingApprovalsArgs {
  organizationId: string;
  resourceType?: ApprovalResourceType;
  limit?: number;
}

export async function listPendingApprovals(
  ctx: QueryCtx,
  args: ListPendingApprovalsArgs,
): Promise<Array<ApprovalItem>> {
  const limit = args.limit ?? 1000; // Default limit to prevent unbounded queries

  // If resourceType is provided, use the more specific index
  if (args.resourceType) {
    const resourceType = args.resourceType;
    return await ctx.db
      .query('approvals')
      .withIndex('by_org_status_resourceType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('status', 'pending')
          .eq('resourceType', resourceType),
      )
      .order('desc')
      .take(limit);
  }

  // Otherwise, use by_org_status index
  return await ctx.db
    .query('approvals')
    .withIndex('by_org_status', (q) =>
      q.eq('organizationId', args.organizationId).eq('status', 'pending'),
    )
    .order('desc')
    .take(limit);
}

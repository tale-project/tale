import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { ListApprovalsResult } from './types';
import type { ApprovalResourceType } from '../../../../model/approvals/types';

const VALID_RESOURCE_TYPES: ApprovalResourceType[] = [
  'conversations',
  'product_recommendation',
];

export async function listPendingApprovals(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    resourceType?: string;
  },
): Promise<ListApprovalsResult> {
  // Validate resourceType at runtime when defined
  if (
    params.resourceType !== undefined &&
    !VALID_RESOURCE_TYPES.includes(params.resourceType as ApprovalResourceType)
  ) {
    throw new Error(
      `Invalid resourceType: "${params.resourceType}". Expected one of: ${VALID_RESOURCE_TYPES.join(', ')}`,
    );
  }

  const approvals = await ctx.runQuery(
    internal.approvals.listPendingApprovals,
    {
      organizationId: params.organizationId,
      resourceType: params.resourceType as ApprovalResourceType | undefined,
    },
  );

  return {
    operation: 'list_pending_approvals',
    approvals,
    count: approvals.length,
  };
}

import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { ListApprovalsResult } from './types';
import type { ApprovalResourceType } from '../../../../model/approvals/types';

const VALID_RESOURCE_TYPES: ApprovalResourceType[] = [
  'conversations',
  'product_recommendation',
];

export async function getApprovalHistory(
  ctx: ActionCtx,
  params: {
    resourceType: string;
    resourceId: string;
  },
): Promise<ListApprovalsResult> {
  // Validate resourceType at runtime
  if (
    !VALID_RESOURCE_TYPES.includes(params.resourceType as ApprovalResourceType)
  ) {
    throw new Error(
      `Invalid resourceType: "${params.resourceType}". Expected one of: ${VALID_RESOURCE_TYPES.join(', ')}`,
    );
  }

  const approvals = await ctx.runQuery(internal.approvals.getApprovalHistory, {
    resourceType: params.resourceType as ApprovalResourceType,
    resourceId: params.resourceId,
  });

  return {
    operation: 'get_approval_history',
    approvals,
    count: approvals.length,
  };
}

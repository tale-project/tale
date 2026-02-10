import type { ConvexJsonRecord } from '../../../../../lib/shared/schemas/utils/json-value';
import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';
import type { ApprovalResourceType } from '../../../../approvals/types';
import type {
  CreateApprovalResult,
  ApprovalPriority,
  ApprovalData,
} from './types';

import { internal } from '../../../../_generated/api';

export async function createApproval(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    resourceType: string;
    resourceId: string;
    priority: ApprovalPriority;
    requestedBy?: string;
    dueDate?: number;
    description?: string;
    wfExecutionId?: Id<'wfExecutions'>;
    stepSlug?: string;
    metadata?: ConvexJsonRecord;
  },
): Promise<CreateApprovalResult> {
  const approvalId: Id<'approvals'> = await ctx.runMutation(
    internal.approvals.internal_mutations.createApproval,
    {
      organizationId: params.organizationId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex field type
      resourceType: params.resourceType as ApprovalResourceType,
      resourceId: params.resourceId,
      priority: params.priority,
      requestedBy: params.requestedBy,
      dueDate: params.dueDate,
      description: params.description,
      wfExecutionId: params.wfExecutionId,
      stepSlug: params.stepSlug,
      metadata: params.metadata,
    },
  );

  // Fetch and return the full created entity
  const createdApproval = await ctx.runQuery(
    internal.approvals.internal_queries.getApprovalById,
    { approvalId },
  );

  if (!createdApproval) {
    throw new Error(`Failed to fetch created approval with ID "${approvalId}"`);
  }

  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex document field
  return createdApproval as ApprovalData;
}

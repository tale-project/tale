import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { CreateApprovalResult, ApprovalPriority } from './types';
import type { ApprovalResourceType } from '../../../../model/approvals/types';

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
    metadata?: unknown;
  },
): Promise<CreateApprovalResult> {
  const approvalId: Id<'approvals'> = await ctx.runMutation(
    internal.mutations.approvals.createApproval,
    {
      organizationId: params.organizationId,
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
    internal.queries.approvals.getApprovalById,
    { approvalId },
  );

  if (!createdApproval) {
    throw new Error(`Failed to fetch created approval with ID "${approvalId}"`);
  }

  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  return createdApproval;
}

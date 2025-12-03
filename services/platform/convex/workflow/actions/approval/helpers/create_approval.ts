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
    internal.approvals.createApproval,
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

  return {
    operation: 'create_approval',
    approvalId,
    success: true,
    timestamp: Date.now(),
  };
}

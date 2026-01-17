/**
 * Create a new approval (internal operation)
 */

import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { CreateApprovalArgs } from './types';

export async function createApproval(
  ctx: MutationCtx,
  args: CreateApprovalArgs,
): Promise<Id<'approvals'>> {
  const approvalId = await ctx.db.insert('approvals', {
    organizationId: args.organizationId,
    wfExecutionId: args.wfExecutionId,
    stepSlug: args.stepSlug,
    status: 'pending',
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    priority: args.priority,
    dueDate: args.dueDate,
    threadId: args.threadId,
    messageId: args.messageId,
    metadata: {
      requestedBy: args.requestedBy,
      createdAt: Date.now(),
      description: args.description,
      ...(args.metadata as Record<string, unknown>),
    },
  });

  return approvalId;
}

/**
 * Link pending approvals to a message ID
 *
 * This is called after an agent response stream completes to link any
 * pending approvals created during that response to the assistant message.
 */

import type { MutationCtx } from '../../_generated/server';

export interface LinkApprovalsToMessageArgs {
  threadId: string;
  messageId: string;
}

/**
 * Links all pending integration operation approvals in a thread
 * that don't have a messageId to the provided messageId.
 *
 * This should be called after the agent stream completes.
 */
export async function linkApprovalsToMessage(
  ctx: MutationCtx,
  args: LinkApprovalsToMessageArgs,
): Promise<number> {
  const { threadId, messageId } = args;

  // Find all pending integration_operation approvals in this thread using index
  // Uses the by_threadId_status_resourceType index for efficient querying
  const query = ctx.db
    .query('approvals')
    .withIndex('by_threadId_status_resourceType', (q) =>
      q
        .eq('threadId', threadId)
        .eq('status', 'pending')
        .eq('resourceType', 'integration_operation'),
    )
    .filter((q) => q.eq(q.field('messageId'), undefined));

  // Iterate and update each approval with the messageId
  let linkedCount = 0;
  for await (const approval of query) {
    await ctx.db.patch(approval._id, { messageId });
    linkedCount++;
  }

  return linkedCount;
}

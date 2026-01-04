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
 * Links all pending approvals in a thread that don't have a messageId
 * to the provided messageId.
 *
 * This handles both integration_operation and workflow_creation approvals.
 * This should be called after the agent stream completes.
 */
export async function linkApprovalsToMessage(
  ctx: MutationCtx,
  args: LinkApprovalsToMessageArgs,
): Promise<number> {
  const { threadId, messageId } = args;

  // Resource types that need to be linked to messages
  const resourceTypesToLink = [
    'integration_operation',
    'workflow_creation',
  ] as const;

  let linkedCount = 0;

  // Link each resource type separately using the composite index
  for (const resourceType of resourceTypesToLink) {
    const query = ctx.db
      .query('approvals')
      .withIndex('by_threadId_status_resourceType', (q) =>
        q
          .eq('threadId', threadId)
          .eq('status', 'pending')
          .eq('resourceType', resourceType),
      )
      .filter((q) => q.eq(q.field('messageId'), undefined));

    // Iterate and update each approval with the messageId
    for await (const approval of query) {
      await ctx.db.patch(approval._id, { messageId });
      linkedCount++;
    }
  }

  return linkedCount;
}

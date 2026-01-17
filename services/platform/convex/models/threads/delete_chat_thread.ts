/**
 * Delete (archive) a chat thread using Convex Agent Component.
 * Sets status to "archived" to allow recovery if needed.
 */

import { MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';

export async function deleteChatThread(
  ctx: MutationCtx,
  threadId: string,
): Promise<void> {
  // Archive thread by setting status to "archived"
  await ctx.runMutation(components.agent.threads.updateThread, {
    threadId: threadId,
    patch: {
      status: 'archived',
    },
  });
}


/**
 * Update a chat thread's title using Convex Agent Component.
 */

import { MutationCtx } from '../../_generated/server';
import { components } from '../../_generated/api';

export async function updateChatThread(
  ctx: MutationCtx,
  threadId: string,
  title: string,
): Promise<void> {
  // Update thread using Agent Component
  await ctx.runMutation(components.agent.threads.updateThread, {
    threadId: threadId,
    patch: {
      title: title,
    },
  });
}


import {
  abortStream,
  listMessages,
  listStreams,
  saveMessage,
} from '@convex-dev/agent';

import type { MutationCtx } from '../_generated/server';

import { components } from '../_generated/api';

/**
 * Cancel an active AI generation for a thread.
 *
 * 1. Validates thread ownership.
 * 2. Aborts all active (streaming) streams for the thread.
 * 3. If displayedContent is provided, truncates the latest assistant message
 *    to match what the user saw on screen when they clicked stop.
 */
export async function cancelGeneration(
  ctx: MutationCtx,
  userId: string,
  threadId: string,
  displayedContent?: string | null,
): Promise<void> {
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId,
  });
  if (!thread || thread.userId !== userId) {
    throw new Error('Thread not found');
  }

  const activeStreams = await listStreams(ctx, components.agent, {
    threadId,
    includeStatuses: ['streaming'],
  });

  for (const stream of activeStreams) {
    await abortStream(ctx, components.agent, {
      streamId: stream.streamId,
      reason: 'user-cancelled',
    });
  }

  const messagesResult = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { numItems: 5, cursor: null },
    excludeToolMessages: true,
  });

  const latestAssistant = messagesResult.page.find(
    (m) => m.message?.role === 'assistant',
  );

  if (latestAssistant && latestAssistant.status !== 'success') {
    const patch: {
      status: 'failed';
      message?: { role: 'assistant'; content: string };
    } = {
      status: 'failed',
    };

    if (displayedContent != null) {
      patch.message = { role: 'assistant', content: displayedContent };
    }

    await ctx.runMutation(components.agent.messages.updateMessage, {
      messageId: latestAssistant._id,
      patch,
    });
  } else if (!latestAssistant) {
    // No assistant message yet (very early stop). Create one with empty
    // content and failed status so the frontend exits loading and shows
    // "Generation stopped" via the isAborted flag.
    await saveMessage(ctx, components.agent, {
      threadId,
      message: {
        role: 'assistant',
        content: displayedContent ?? '',
      },
      metadata: { status: 'failed' },
    });
  }
}

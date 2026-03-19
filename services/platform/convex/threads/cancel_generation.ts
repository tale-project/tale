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
  } else if (!latestAssistant || latestAssistant.status === 'success') {
    // Either no assistant message exists yet, or the latest one is from a
    // previous successful turn (early stop before the new generation's
    // assistant message was created). Create a failed message so the
    // abort watcher detects it and the frontend shows "Generation stopped".
    await saveMessage(ctx, components.agent, {
      threadId,
      message: {
        role: 'assistant',
        content: displayedContent ?? '',
      },
      metadata: { status: 'failed' },
    });
  }

  // Clear generation status so isThreadGenerating returns false immediately
  const threadMeta = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();
  if (threadMeta?.generationStatus === 'generating') {
    await ctx.db.patch(threadMeta._id, {
      generationStatus: 'idle',
      streamId: undefined,
    });
  }
}

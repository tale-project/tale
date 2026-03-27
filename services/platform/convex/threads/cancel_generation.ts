import { abortStream, listMessages, listStreams } from '@convex-dev/agent';

import type { MutationCtx } from '../_generated/server';

import { components } from '../_generated/api';

/**
 * Cancel an active AI generation for a thread.
 *
 * 1. Validates thread ownership.
 * 2. Aborts all active (streaming) SDK streams.
 * 3. Sets cancelledAt on threadMetadata so the running action detects it.
 * 4. If displayedContent is provided, marks the latest assistant message as
 *    "success" with that content (ChatGPT-style clean stop).
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

  // Abort all active SDK streams
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

  // Mark the latest assistant message based on displayed content
  const messagesResult = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { numItems: 5, cursor: null },
    excludeToolMessages: true,
  });

  const latestAssistant = messagesResult.page.find(
    (m) => m.message?.role === 'assistant',
  );

  if (latestAssistant && latestAssistant.status !== 'success') {
    if (displayedContent?.trim()) {
      // ChatGPT-style: preserve displayed content as a successful message
      await ctx.runMutation(components.agent.messages.updateMessage, {
        messageId: latestAssistant._id,
        patch: {
          status: 'success',
          message: { role: 'assistant', content: displayedContent },
        },
      });
    } else {
      // No content was displayed — mark as failed so frontend shows clean state
      await ctx.runMutation(components.agent.messages.updateMessage, {
        messageId: latestAssistant._id,
        patch: { status: 'failed' },
      });
    }
  }
  // If no assistant message exists yet (early cancel), don't create one.
  // The cancelledAt signal is sufficient for the running action to detect.

  // Set cancelledAt and clear generation status
  const threadMeta = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();
  if (threadMeta) {
    await ctx.db.patch(threadMeta._id, {
      cancelledAt: Date.now(),
      cancelledMessageId: latestAssistant?._id,
      generationStatus: 'idle',
      streamId: undefined,
    });
  }
}

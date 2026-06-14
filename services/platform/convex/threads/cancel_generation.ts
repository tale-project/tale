import { abortStream, listMessages, listStreams } from '@convex-dev/agent';

import { components, internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { truncateAssistantContent } from './truncate_message_content';

/**
 * Cancel an active AI generation for a thread.
 *
 * 1. Validates thread ownership.
 * 2. Aborts all active (streaming) SDK streams.
 * 3. Sets cancelledAt on threadMetadata so the running action detects it.
 * 4. Updates the latest assistant message:
 *    - If `displayedLength > 0`: truncate the message content in-place to
 *      that length, preserving every non-text part (reasoning, tool-call,
 *      tool-result, file, source). Marks status=success — the user sees
 *      exactly what the typewriter had revealed.
 *    - If no displayed length but the message already has streamed text:
 *      mark status=success without touching content (don't lose deltas).
 *    - Otherwise (truly empty): mark status=failed → rendered as a clean
 *      "aborted" bubble by the UI.
 */
export async function cancelGeneration(
  ctx: MutationCtx,
  userId: string,
  threadId: string,
  displayedLength?: number | null,
  opts?: {
    /**
     * User-facing Stop: after the cancel settles, auto-resume any queued
     * messages as the next turn (threads/message_queue.ts). The drain is
     * scheduled a few seconds out so the exec-cancel cascade finishes first.
     * The supersede path (chat_turn.ts) leaves this off — its own new turn is
     * the successor and queued rows drain at THAT turn's boundary.
     */
    drainQueue?: boolean;
  },
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

  // Find the latest assistant message and decide how to finalise it.
  const messagesResult = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { numItems: 5, cursor: null },
    excludeToolMessages: true,
  });

  const latestAssistant = messagesResult.page.find(
    (m) => m.message?.role === 'assistant',
  );

  if (latestAssistant && latestAssistant.status !== 'success') {
    const message = latestAssistant.message;
    const hasDisplayedLength =
      typeof displayedLength === 'number' && displayedLength > 0;

    if (hasDisplayedLength && message?.role === 'assistant') {
      // ChatGPT-style: keep exactly what the user saw. Truncate text
      // content to displayedLength while preserving structured parts.
      const truncated = truncateAssistantContent(
        message.content,
        displayedLength,
      );
      await ctx.runMutation(components.agent.messages.updateMessage, {
        messageId: latestAssistant._id,
        patch: {
          status: 'success',
          message: { ...message, content: truncated },
        },
      });
    } else if (latestAssistant.text?.trim()) {
      // No displayed-length signal (snapshot raced / refs unregistered),
      // but content was already streamed. Preserve what's persisted rather
      // than discarding it — better to show "more than the user saw" than
      // to vaporise their reply.
      await ctx.runMutation(components.agent.messages.updateMessage, {
        messageId: latestAssistant._id,
        patch: { status: 'success' },
      });
    } else {
      // Truly empty (cancel fired before any token was streamed).
      // Mark failed so the UI renders the clean aborted bubble.
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

  // (artifact in-flight stream cleanup removed — artifacts module deleted.)
  void threadMeta;

  // Cascade Stop to any running sandbox executions on this thread. Scheduled
  // (not awaited) because the action calls the spawner over HTTP and we
  // don't want to block the user's Stop-acknowledged response on a network
  // round-trip. The mutation that finalizes each execution is terminal-state
  // guarded so racing with `executeCode`'s own finalize is safe.
  //
  // TWO cascades, because the two sandbox paths use different tables:
  //   - one-shot `executeCode` → `sandboxExecutions` (cancelExecutionsForThread)
  //   - external-agent turns   → `sandboxSessionOps` (cancelSessionExecsForThread)
  // Without the second, clicking Stop never actually cancelled an external-agent
  // run's in-sandbox process.
  try {
    await ctx.scheduler.runAfter(
      0,
      internal.node_only.sandbox.internal_actions.cancelExecutionsForThread,
      { threadId },
    );
  } catch (err) {
    console.warn(
      '[cancelGeneration] scheduler.runAfter(cancelExecutionsForThread) failed:',
      err,
    );
  }
  try {
    await ctx.scheduler.runAfter(
      0,
      internal.node_only.sandbox.internal_actions.cancelSessionExecsForThread,
      { threadId },
    );
  } catch (err) {
    console.warn(
      '[cancelGeneration] scheduler.runAfter(cancelSessionExecsForThread) failed:',
      err,
    );
  }

  // User Stop with messages still queued → auto-resume them as the next turn
  // (--resume keeps the agent context). Deferred so the cancel cascade above
  // kills the running exec before the drain turn spawns a new one; the drain
  // mutation re-checks the thread is still idle and the rows still queued.
  if (opts?.drainQueue) {
    const queued = await ctx.db
      .query('chatMessageQueue')
      .withIndex('by_threadId_status', (q) =>
        q.eq('threadId', threadId).eq('status', 'queued'),
      )
      .first();
    if (queued) {
      try {
        await ctx.scheduler.runAfter(
          3000,
          internal.threads.message_queue.drainQueuedMessages,
          { threadId },
        );
      } catch (err) {
        console.warn(
          '[cancelGeneration] scheduler.runAfter(drainQueuedMessages) failed:',
          err,
        );
      }
    }
  }
}

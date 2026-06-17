import { listMessages, type MessageDoc } from '@convex-dev/agent';

import { components, internal } from '../../_generated/api';
import type { GenerateResponseArgs } from './types';

/**
 * Find the first assistant message in the latest response order group and
 * link any pending approvals to it. Pending approvals are queried by
 * threadId but only rendered in the UI once their messageId field is set,
 * so this must complete BEFORE clearGenerationStatus or the user sees the
 * spinner stop, then a "approve this action" panel pop in a beat later.
 *
 * Wrapped in try/catch — approval linking is non-fatal.
 */
export async function linkApprovalsToLatestAssistantMessage(
  ctx: GenerateResponseArgs['ctx'],
  threadId: string,
  debugLog: (...args: unknown[]) => void,
): Promise<void> {
  try {
    const messagesResult = await listMessages(ctx, components.agent, {
      threadId,
      paginationOpts: { cursor: null, numItems: 50 },
      excludeToolMessages: false,
    });

    // Find the first assistant message in the current response order group.
    // We must link to an assistant message (not tool messages) because the UI
    // only loads user/assistant messages — tool message IDs are not in the
    // rendered message set and approvals linked to them would be invisible.
    const latestAssistantMessage = messagesResult.page.find(
      (m: MessageDoc) => m.message?.role === 'assistant',
    );
    if (!latestAssistantMessage) return;

    const currentOrder = latestAssistantMessage.order;
    const firstAssistantInOrder =
      messagesResult.page
        .filter(
          (m: MessageDoc) =>
            m.order === currentOrder && m.message?.role === 'assistant',
        )
        .sort((a: MessageDoc, b: MessageDoc) => a.stepOrder - b.stepOrder)[0] ??
      latestAssistantMessage;

    const linkedCount = await ctx.runMutation(
      internal.approvals.internal_mutations.linkApprovalsToMessage,
      {
        threadId,
        messageId: firstAssistantInOrder._id,
      },
    );
    if (linkedCount > 0) {
      debugLog(
        `Linked ${linkedCount} pending approvals to message ${firstAssistantInOrder._id}`,
      );
    }
  } catch (error) {
    console.error(
      '[generateAgentResponse] Failed to link approvals to message:',
      error,
    );
  }
}

/**
 * Finalize the persistent text stream after a successful generation. The
 * Agent SDK's DeltaStreamer already delivered text to the client in real
 * time; this only updates the persistent stream document used for refresh
 * recovery and HTTP polling. Non-fatal: if the stream is in a terminal
 * state from a prior fallback attempt, these mutations may fail and that
 * must not turn a successful response into a failure.
 *
 * When `cancelled` is true, only `completeStream` is called (no append) —
 * content was already streamed via the SDK before the abort.
 */
export async function finalizePersistentStream(
  ctx: GenerateResponseArgs['ctx'],
  streamId: string,
  text: string,
  cancelled: boolean,
): Promise<void> {
  try {
    if (!cancelled && text) {
      await ctx.runMutation(
        internal.streaming.internal_mutations.appendToStream,
        { streamId, text },
      );
    }
    await ctx.runMutation(
      internal.streaming.internal_mutations.completeStream,
      { streamId },
    );
  } catch (streamError) {
    console.error(
      '[generateAgentResponse] Persistent stream finalization failed (non-fatal):',
      streamError,
    );
  }
}

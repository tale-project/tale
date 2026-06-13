/** Queue-row lifecycle status (mirror of `chatMessageQueue.status`). */
export type QueuedStatus = 'queued' | 'claimed' | 'delivered' | 'consumed';

/**
 * Decide which messages render in the conversation when an external-agent
 * (Claude Code) turn is running and the user has queued follow-ups.
 *
 * A follow-up sent mid-turn is persisted to the timeline at enqueue, so it is
 * ALSO present in the message list. While it is still waiting for the agent
 * (status `queued`/`delivered`) it belongs in the pending-queue strip above the
 * composer, NOT inline — so we hide it here. Once the agent claims/consumes it
 * (or the row is gone), it reveals inline as normal history.
 *
 * `queuedStatusById === undefined` means the queue subscription has not resolved
 * yet (e.g. a mid-turn page refresh). We can't yet know which messages are
 * queued, but on a generating thread a queued follow-up always sits AFTER the
 * running turn's streaming assistant bubble — so we withhold trailing user
 * messages to avoid a flash of them rendering inline before the query lands and
 * routes them to the strip. The running turn's own prompt always PRECEDES its
 * assistant, so it is never withheld; if no assistant row exists yet we withhold
 * nothing (favouring showing content over hiding the prompt).
 */
export function filterVisibleMessages<
  T extends { id: string; role: 'user' | 'assistant' | 'system' },
>(
  messages: T[],
  queuedStatusById: Map<string, { status: QueuedStatus }> | undefined,
  isGenerating: boolean,
): T[] {
  if (queuedStatusById !== undefined) {
    if (queuedStatusById.size === 0) return messages;
    return messages.filter((m) => {
      const status = queuedStatusById.get(m.id)?.status;
      return !(status === 'queued' || status === 'delivered');
    });
  }

  if (!isGenerating) return messages;
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx === -1) return messages;
  return messages.filter(
    (m, i) => !(i > lastAssistantIdx && m.role === 'user'),
  );
}

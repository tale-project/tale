import type { ChatMessage } from '../hooks/use-message-processing';
import { hasThoughtSteps } from './thought-predicates';

/** Last user index scanning backward — shared by shell suppression + visibility. */
export function findLastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i;
  }
  return -1;
}

/** True when the most recent assistant before the last user is still streaming. */
export function computeStreamingAssistantAboveLastUser(
  messages: ChatMessage[],
): boolean {
  const lastUserIdx = findLastUserIndex(messages);
  if (lastUserIdx <= 0) return false;
  for (let i = lastUserIdx - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    return m.isStreaming === true;
  }
  return false;
}

export function anchorBubbleExistsInMessages(
  messages: ChatMessage[],
  liveAssistantMessageId: string | null | undefined,
): boolean {
  if (liveAssistantMessageId == null) return false;
  return messages.some(
    (m) => m.role === 'assistant' && m.id === liveAssistantMessageId,
  );
}

/** Whether to skip appending the optimistic assistant shell below the last user. */
export function shouldSuppressOptimisticShell(opts: {
  streamingAssistantAboveLastUser: boolean;
  liveAssistantMessageId?: string | null;
  anchorBubbleExists: boolean;
}): boolean {
  if (opts.streamingAssistantAboveLastUser) return true;
  if (opts.liveAssistantMessageId != null && opts.anchorBubbleExists) {
    return true;
  }
  return false;
}

export function createOptimisticAssistantShell(timestamp: Date): ChatMessage {
  const ts = timestamp.getTime();
  return {
    id: `pending-assistant-${ts}`,
    key: `pending-assistant-${ts}`,
    role: 'assistant',
    content: '',
    timestamp,
    isStreaming: true,
    isOptimisticShell: true,
  };
}

/** Empty streaming assistant row (steer owner or pre-token server shell). */
export function isEmptyStreamingAssistantShell(m: ChatMessage): boolean {
  return (
    m.role === 'assistant' &&
    m.isStreaming === true &&
    !m.content &&
    !hasThoughtSteps(m.parts) &&
    !m.isAborted &&
    !m.isFailed
  );
}

/**
 * True once a non-optimistic assistant after the last user has something the
 * bubble layer can render (or a terminal state). Used to drop the optimistic
 * shell — NOT keyed on raw subscription tail (file-only hide may omit rows).
 *
 * Pure placeholders (`id` still `pending-assistant-*`) are ignored until
 * promoted with the real server row. Promoted rows (`isOptimisticShell` with a
 * real id) participate once they have renderable content.
 */
export function hasVisibleAssistantAfterLastUser(
  messages: ChatMessage[],
  isSendPending?: boolean,
  baselineAssistantIds?: ReadonlySet<string>,
): boolean {
  const lastUserIdx = findLastUserIndex(messages);
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    if (m.isOptimisticShell && m.id.startsWith('pending-assistant-')) continue;
    // A row that appeared AFTER the shell mounted is this turn's answer: any
    // renderable material makes it visible even while `isSendPending` lingers.
    // A fast model can complete the whole turn between two isGenerating
    // snapshots (the client never sees `true`, so the optimistic flag stays
    // up); the row then lands already COMPLETE (isStreaming false + content),
    // and the `!isSendPending` guard below would deny it — re-opening a
    // fresh-keyed shell over the finished answer (remount + Thinking flash).
    // Baseline rows (present at shell creation, e.g. the resolved
    // request_human_input bubble on resume) keep the guarded rules.
    if (
      baselineAssistantIds &&
      !baselineAssistantIds.has(m.id) &&
      (!!m.content || hasThoughtSteps(m.parts) || m.isAborted || m.isFailed)
    ) {
      return true;
    }
    if (
      (m.isStreaming === true && (!!m.content || hasThoughtSteps(m.parts))) ||
      m.isAborted ||
      m.isFailed ||
      (!!m.content && !isSendPending)
    ) {
      return true;
    }
  }
  return false;
}

/** Real (non-placeholder) assistant row after the last user — shell must not duplicate it. */
export function hasRealAssistantRowAfterLastUser(
  messages: ChatMessage[],
): boolean {
  const lastUserIdx = findLastUserIndex(messages);
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    const m = messages[i];
    if (
      m.role === 'assistant' &&
      !(m.isOptimisticShell && m.id.startsWith('pending-assistant-'))
    ) {
      return true;
    }
  }
  return false;
}

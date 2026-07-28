/**
 * The conversation's single data seam: one hook that merges the message list,
 * the live generation, and the streamed in-flight text into render-ready
 * rows. The merge itself is `reduceThreadView` in `lib/thread-view-core.ts`
 * (pure, unit-tested); this hook owns the three subscriptions and the
 * per-thread state scope.
 */

import { useRef } from 'react';

import { api } from '@/convex/_generated/api';

import { useChatQuery } from '../data/chat-backend';
import {
  createThreadViewState,
  reduceThreadView,
  type ThreadViewResult,
  type ThreadViewState,
} from '../lib/thread-view-core';
import type { PendingSend } from '../utils/pending-messages';

export interface ThreadView extends ThreadViewResult {
  /** The message list's own status — `loading` only before the first answer
   * for this thread arrives (or is served from the session cache). */
  readonly status: 'ready' | 'loading' | 'unavailable';
}

const EMPTY_VIEW: ThreadView = {
  status: 'loading',
  items: [],
  generation: null,
  streamingMessageId: undefined,
  pendingConsumed: false,
};

/**
 * The conversation view for one thread. Pass `undefined` to render an empty
 * idle view (the new-chat surface with no thread yet).
 */
export function useThreadView(
  organizationId: string,
  threadId: string | undefined,
  /** The in-flight optimistic send, overlaid when it targets this thread. */
  pending?: PendingSend | null,
): ThreadView {
  const messages = useChatQuery(
    api.chat.messages.listMessages,
    threadId !== undefined ? { organizationId, threadId } : 'skip',
  );
  // Absence is a signal for both live reads (idle vs. streaming), so neither
  // may serve a stale cached value; the merge latches across their gaps.
  const generation = useChatQuery(
    api.chat.generations.getGeneration,
    threadId !== undefined ? { organizationId, threadId } : 'skip',
    { cache: false },
  );
  const generationText = useChatQuery(
    api.chat.generations.getGenerationText,
    threadId !== undefined ? { organizationId, threadId } : 'skip',
    { cache: false },
  );

  const scopeKey = `${organizationId}:${threadId ?? ''}`;
  const stateRef = useRef<{ scope: string; state: ThreadViewState } | null>(
    null,
  );
  if (stateRef.current === null || stateRef.current.scope !== scopeKey) {
    stateRef.current = { scope: scopeKey, state: createThreadViewState() };
  }

  if (threadId === undefined) return EMPTY_VIEW;

  const view = reduceThreadView(stateRef.current.state, {
    messages: messages.status === 'ready' ? messages.data : undefined,
    generation: generation.status === 'ready' ? generation.data : undefined,
    generationText:
      generationText.status === 'ready' ? generationText.data : undefined,
    pending: pending != null && pending.threadId === threadId ? pending : null,
  });

  return {
    status: messages.status,
    ...view,
  };
}

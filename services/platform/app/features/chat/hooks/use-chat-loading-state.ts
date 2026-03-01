import type { UIMessage } from '@convex-dev/agent/react';

import { useEffect, useMemo, useRef } from 'react';

interface UseChatLoadingStateParams {
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
  uiMessages: UIMessage[] | undefined;
  threadId: string | undefined;
  pendingThreadId: string | null;
}

const STABLE_OFF_DEBOUNCE_MS = 2_000;
const SAFETY_TIMEOUT_MS = 60_000;

/**
 * Derives a single `isLoading` boolean that answers: "Is the AI turn active?"
 *
 * `isLoading = isPending || isMessageActive`
 *
 * `isMessageActive` is a pure derivation from `uiMessages`: scans ALL messages
 * so that a non-terminal assistant message anywhere keeps it true. `failed` is
 * unconditionally terminal — the SDK maps stream abort to `failed`, and a
 * failed generation cannot resume.
 *
 * `isPending` bridges the entire turn — from send to AI response completion.
 * It is only cleared when ALL three conditions are met simultaneously and
 * remain stable for a debounce period:
 *   1. The subscription acknowledged the generation (`hasSeenActive`)
 *   2. No active streaming messages exist (`!isMessageActive`)
 *   3. A genuinely NEW terminal assistant appeared (`_creationTime > baseline`)
 *
 * The creation-time baseline prevents subscription oscillation and pagination
 * window shifts from triggering false clears — old assistants that appear due
 * to pagination always have earlier creation times. The debounce prevents
 * brief subscription flickers from clearing prematurely.
 *
 * Thread-mismatch cleanup handles the case where the user navigates away
 * from the pending thread.
 */
export function useChatLoadingState({
  isPending,
  setIsPending,
  uiMessages,
  threadId,
  pendingThreadId,
}: UseChatLoadingStateParams) {
  // Snapshot the max _creationTime when isPending becomes true.
  // Only a NEW assistant (created after this timestamp) with terminal status
  // can clear isPending. Old assistants exposed by pagination shifts have
  // earlier creation times and are ignored.
  const baselineCreationTimeRef = useRef<number | null>(null);

  // Track whether isMessageActive was ever true during this pending cycle.
  const hasSeenActiveRef = useRef(false);

  if (
    isPending &&
    baselineCreationTimeRef.current === null &&
    uiMessages?.length
  ) {
    baselineCreationTimeRef.current = Math.max(
      ...uiMessages.map((m) => m._creationTime),
    );
  }
  if (!isPending) {
    baselineCreationTimeRef.current = null;
    hasSeenActiveRef.current = false;
  }

  // Derive loading purely from message statuses.
  const isMessageActive = useMemo(() => {
    if (!uiMessages?.length) return false;

    if (
      uiMessages.some(
        (m) =>
          m.role === 'assistant' &&
          m.status !== 'success' &&
          m.status !== 'failed',
      )
    )
      return true;

    const lastMessage = uiMessages[uiMessages.length - 1];

    if (lastMessage.role !== 'assistant') return true;

    const status: string | undefined = lastMessage.status;
    return !(status === 'success' || status === 'failed');
  }, [uiMessages]);

  // Mark that the subscription acknowledged the generation.
  if (isPending && isMessageActive) {
    hasSeenActiveRef.current = true;
  }

  const isLoading = isPending || isMessageActive;

  // Clear isPending only when ALL conditions are met simultaneously for
  // STABLE_OFF_DEBOUNCE_MS:
  //   1. hasSeenActive — subscription saw the generation start
  //   2. !isMessageActive — no active streaming messages
  //   3. New terminal assistant with _creationTime > baseline — generation
  //      actually completed (not just subscription oscillation hiding messages)
  //
  // The effect re-runs on every uiMessages change. If conditions stay met
  // across updates, the timer resets each time — it only fires after the
  // subscription stabilizes for the full debounce period.
  useEffect(() => {
    if (!isPending || !hasSeenActiveRef.current || isMessageActive) return;
    if (baselineCreationTimeRef.current === null || !uiMessages?.length) return;

    const baseline = baselineCreationTimeRef.current;
    const hasNewTerminalAssistant = uiMessages.some(
      (m) =>
        m.role === 'assistant' &&
        (m.status === 'success' || m.status === 'failed') &&
        m._creationTime > baseline,
    );

    if (!hasNewTerminalAssistant) return;

    const timer = setTimeout(() => {
      setIsPending(false);
    }, STABLE_OFF_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [isPending, isMessageActive, uiMessages, setIsPending]);

  // Safety valve: clear isPending after a max lifetime to prevent stuck states
  // (e.g. silent mutation failure, network partition).
  useEffect(() => {
    if (!isPending) return;

    const timeout = setTimeout(() => {
      setIsPending(false);
    }, SAFETY_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [isPending, setIsPending]);

  // Thread mismatch: navigated away from the pending thread.
  useEffect(() => {
    if (!isPending) return;

    if (
      pendingThreadId !== null &&
      (pendingThreadId ?? null) !== (threadId ?? null)
    ) {
      setIsPending(false);
    }
  }, [isPending, pendingThreadId, threadId, setIsPending]);

  return { isLoading, setIsPendingWithBaseline: setIsPending };
}

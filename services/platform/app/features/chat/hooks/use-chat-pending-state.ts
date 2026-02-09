import type { UIMessage } from '@convex-dev/agent/react';

import { useEffect, useRef } from 'react';

interface UseChatPendingStateParams {
  isPending: boolean;
  setIsPending: (pending: boolean) => void;
  streamingMessage: UIMessage | undefined;
  uiMessages: UIMessage[] | undefined;
}

/**
 * Hook to manage pending state clearing.
 * Clears pending when streaming starts or when a completed message appears.
 *
 * Handles two scenarios:
 * 1. Normal message sending: Uses fallback logic to clear when a completed message appears
 * 2. Human input response: Only clears when streaming actually starts (no fallback)
 *
 * Also handles the case where component remounts during navigation (e.g., first message
 * creates a new thread and navigates to /chat/[threadId]).
 */
export function useChatPendingState({
  isPending,
  setIsPending,
  streamingMessage,
  uiMessages,
}: UseChatPendingStateParams) {
  const pendingUserCountRef = useRef<number | null>(null);
  const isHumanInputPendingRef = useRef(false);

  const setPendingWithCount = (
    pending: boolean,
    isHumanInputResponse = false,
  ) => {
    if (pending) {
      const currentAssistantCount =
        uiMessages?.filter((m) => m.role === 'assistant').length ?? 0;
      pendingUserCountRef.current = currentAssistantCount;
      isHumanInputPendingRef.current = isHumanInputResponse;
    }
    setIsPending(pending);
  };

  useEffect(() => {
    if (!isPending) {
      pendingUserCountRef.current = null;
      isHumanInputPendingRef.current = false;
      return;
    }

    if (streamingMessage) {
      setIsPending(false);
      pendingUserCountRef.current = null;
      isHumanInputPendingRef.current = false;
      return;
    }

    if (isHumanInputPendingRef.current) {
      return;
    }

    const assistantMessages =
      uiMessages?.filter((m) => m.role === 'assistant') ?? [];

    if (pendingUserCountRef.current === null) {
      pendingUserCountRef.current = assistantMessages.length - 1;
    }

    if (assistantMessages.length > pendingUserCountRef.current) {
      const lastAssistantMessage = assistantMessages.at(-1);
      if (
        lastAssistantMessage &&
        lastAssistantMessage.status !== 'streaming' &&
        lastAssistantMessage.text
      ) {
        setIsPending(false);
        pendingUserCountRef.current = null;
      }
    }
  }, [streamingMessage, isPending, setIsPending, uiMessages]);

  return { setPendingWithCount, pendingUserCountRef };
}

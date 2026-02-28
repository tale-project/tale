import { useCallback, useRef } from 'react';

import { useCancelGeneration } from './mutations';
import {
  consumeFrozenDisplayText,
  freezeActiveStream,
  resetGlobalFreeze,
} from './use-stream-buffer';

interface UseStopGeneratingParams {
  threadId: string | undefined;
}

interface UseStopGeneratingResult {
  stopGenerating: () => void;
  resetCancelled: () => void;
}

/**
 * Hook to stop AI generation in progress.
 *
 * Freezes the displayed text at its current position (via module-level
 * freeze signal), sets an optimistic cancelled flag, and fires a backend
 * mutation to abort all active streams for the thread.
 *
 * The cancelled flag must be explicitly reset (via resetCancelled)
 * before sending a new message — otherwise the next response's
 * loading indicator won't appear (pitfall #4).
 */
export function useStopGenerating({
  threadId,
}: UseStopGeneratingParams): UseStopGeneratingResult {
  const cancelledRef = useRef(false);
  const { mutateAsync: cancelGeneration } = useCancelGeneration();

  const stopGenerating = useCallback(() => {
    if (!threadId || cancelledRef.current) return;

    // 1. Freeze the display immediately (client-side, synchronous).
    //    This also snapshots the currently displayed text.
    freezeActiveStream();

    // 2. Set optimistic cancelled flag
    cancelledRef.current = true;

    // 3. Grab the displayed text captured at freeze time
    const displayedContent = consumeFrozenDisplayText();

    // 4. Fire backend mutation to abort active streams and truncate
    //    the message to match what the user saw.
    void cancelGeneration({ threadId, displayedContent });
  }, [threadId, cancelGeneration]);

  const resetCancelled = useCallback(() => {
    cancelledRef.current = false;
    resetGlobalFreeze();
  }, []);

  return {
    stopGenerating,
    resetCancelled,
  };
}

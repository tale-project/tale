'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/** Round ms to the nearest second, floored at 1 so a sub-second window reads as
 *  "1s" rather than "0s". Shared by every header that renders a thinking timer. */
export function toSeconds(ms: number): number {
  return Math.max(1, Math.round(ms / 1000));
}

/**
 * Thinking-window timing, anchored to the turn's SERVER start (`turnStartMs` =
 * generationStartTime, stamped at markGenerating BEFORE routing). ONE stable
 * clock shared by the gap-shell `ThinkingIndicator` and the in-bubble
 * `MessageThoughtHeader`, so the timer neither resets at the routing→agent
 * handoff nor across the new-chat remount, and INCLUDES the routing wait.
 *
 * `clientFallbackRef` covers only the brief pre-markGenerating window before the
 * server value arrives. `liveElapsedMs` ticks every second while `thinking`;
 * `liveDurationMs` latches the final value the instant thinking ends
 * (useLayoutEffect, so the summary paints "Thought for Ns" in one frame).
 */
export function useThinkingTimer(
  turnStartMs: number | undefined,
  thinking: boolean,
): { liveElapsedMs: number | null; liveDurationMs: number | null } {
  const clientFallbackRef = useRef<number | null>(null);
  const prevThinkingRef = useRef(thinking);
  const [liveElapsedMs, setLiveElapsedMs] = useState<number | null>(null);
  const [liveDurationMs, setLiveDurationMs] = useState<number | null>(null);

  const resolveStart = useCallback(() => {
    if (typeof turnStartMs === 'number') return turnStartMs;
    if (clientFallbackRef.current === null) {
      clientFallbackRef.current = Date.now();
    }
    return clientFallbackRef.current;
  }, [turnStartMs]);

  useLayoutEffect(() => {
    if (prevThinkingRef.current && !thinking) {
      setLiveDurationMs(Date.now() - resolveStart());
    }
    prevThinkingRef.current = thinking;
  }, [thinking, resolveStart]);

  useEffect(() => {
    if (!thinking) return undefined;
    setLiveElapsedMs(Date.now() - resolveStart());
    const id = setInterval(() => {
      setLiveElapsedMs(Date.now() - resolveStart());
    }, 1000);
    return () => clearInterval(id);
  }, [thinking, resolveStart]);

  return { liveElapsedMs, liveDurationMs };
}

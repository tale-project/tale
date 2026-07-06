'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useClockOffset } from '@/app/hooks/use-clock-offset';

/** Round ms to the nearest second, floored at 1 so a sub-second window reads as
 *  "1s" rather than "0s". Shared by every header that renders a thinking timer. */
export function toSeconds(ms: number): number {
  return Math.max(1, Math.round(ms / 1000));
}

/**
 * The thinking-timer anchor, resolved once per turn in `chat-interface`. BOTH
 * fields live in the raw CLIENT clock frame, so `clientEpochNow() - start` is
 * always a single-clock subtraction — never client-now minus a server epoch
 * (the old rewind):
 *
 * - `clientStartMs` — the immutable optimistic send time (`pendingMessage.
 *   timestamp`). PREFERRED, and present for the entire in-flight turn (it
 *   advances to a follow-up's send time), so a live turn NEVER swaps clocks.
 * - `serverStartClientMs` — the server turn-start (`generationStartTime`, incl.
 *   the follow-up re-anchor) CONVERTED into the client frame via the clock
 *   offset. Used only when there is no client anchor (page reload / history).
 * - `reanchorKey` — changes ONLY on a deliberate re-anchor (new turn / follow-up).
 *   The timer latches its start by this key and ignores value drift otherwise,
 *   so an anchor that wobbles (offset re-sync, a recomputed memo) can never move
 *   the zero-point mid-turn.
 */
export interface ThinkingAnchor {
  clientStartMs: number | null;
  serverStartClientMs: number | null;
  reanchorKey: string;
}

/**
 * Thinking-window timing. ONE stable clock shared by the gap-shell
 * `ThinkingIndicator` and the in-bubble `MessageThoughtHeader` (both receive the
 * same `anchor`), so the timer neither resets at the routing→agent handoff nor
 * across the new-chat remount, and INCLUDES the routing wait.
 *
 * `liveElapsedMs` ticks every second while `thinking`; `liveDurationMs` latches
 * the final value the instant thinking ends (useLayoutEffect, so the summary
 * paints "Thought for Ns" in one frame). Every reading of "now" goes through
 * `clientEpochNow()` from the clock authority (the sanctioned raw-clock accessor)
 * so this module never touches the raw wall clock directly.
 */
export function useThinkingTimer(
  anchor: ThinkingAnchor | undefined,
  thinking: boolean,
): { liveElapsedMs: number | null; liveDurationMs: number | null } {
  const { clientEpochNow } = useClockOffset();
  const clientFallbackRef = useRef<number | null>(null);
  const prevThinkingRef = useRef(thinking);

  // Latch the resolved start by `reanchorKey`: set on first resolve and again
  // only when the key changes (an intended re-anchor). Value drift under an
  // unchanged key is ignored — the belt-and-braces that freezes the frame even
  // if the upstream anchor ever wobbles.
  const latchedStartRef = useRef<{ key: string; start: number } | null>(null);

  const resolveStart = useCallback((): number => {
    const desired =
      anchor?.clientStartMs ?? anchor?.serverStartClientMs ?? null;
    if (desired !== null) {
      const key = anchor?.reanchorKey ?? 'none';
      const latched = latchedStartRef.current;
      if (!latched || latched.key !== key) {
        latchedStartRef.current = { key, start: desired };
        return desired;
      }
      return latched.start;
    }
    // No anchor yet (the brief pre-markGenerating window): a stable client
    // fallback so the pre-answer indicator can tick before any anchor exists.
    if (clientFallbackRef.current === null) {
      clientFallbackRef.current = clientEpochNow();
    }
    return clientFallbackRef.current;
  }, [anchor, clientEpochNow]);

  // Lazy initial value so a timer that MOUNTS mid-thinking paints the correct
  // elapsed on its FIRST render (the in-bubble header takes over from the
  // pre-answer indicator ~1s after send; a plain `useState(null)` would flash
  // "Thinking" with no "· Ns"). Anchored to the SAME `anchor`, so the value is
  // continuous across the handoff, not reset.
  const [liveElapsedMs, setLiveElapsedMs] = useState<number | null>(() =>
    thinking ? clientEpochNow() - resolveStart() : null,
  );
  const [liveDurationMs, setLiveDurationMs] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (prevThinkingRef.current && !thinking) {
      setLiveDurationMs(clientEpochNow() - resolveStart());
    }
    prevThinkingRef.current = thinking;
  }, [thinking, resolveStart, clientEpochNow]);

  useEffect(() => {
    if (!thinking) return undefined;
    setLiveElapsedMs(clientEpochNow() - resolveStart());
    const id = setInterval(() => {
      setLiveElapsedMs(clientEpochNow() - resolveStart());
    }, 1000);
    return () => clearInterval(id);
  }, [thinking, resolveStart, clientEpochNow]);

  return { liveElapsedMs, liveDurationMs };
}

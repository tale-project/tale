'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useClockOffset } from '@/app/hooks/use-clock-offset';

import type { ChatMessageItem } from '../types';

/** Round ms to the nearest second, floored at 1 so a sub-second window reads as
 *  "1s" rather than "0s". Shared by every header that renders a thinking timer. */
export function toSeconds(ms: number): number {
  return Math.max(1, Math.round(ms / 1000));
}

/**
 * The thinking-timer anchor, resolved once per assistant row. BOTH fields live
 * in the raw CLIENT clock frame, so `clientEpochNow() - start` is always a
 * single-clock subtraction — never client-now minus a server epoch (the old
 * rewind):
 *
 * - `clientStartMs` — the immutable optimistic send time. PREFERRED, and
 *   present for the entire in-flight turn (the adopted row keeps its
 *   `pending-*` key forever), so a live turn NEVER swaps clocks.
 * - `serverStartClientMs` — the row's server creation time (the assistant
 *   placeholder is written at turn start) CONVERTED into the client frame via
 *   the clock offset. Used only when there is no client anchor (page reload /
 *   thread opened mid-turn).
 * - `reanchorKey` — changes ONLY on a deliberate re-anchor (a new turn is a
 *   new row). The timer latches its start by this key and ignores value drift
 *   otherwise, so an anchor that wobbles (offset re-sync, the shell's
 *   `createdAt` swapping to the real row's at adoption) can never move the
 *   zero-point mid-turn.
 */
export interface ThinkingAnchor {
  clientStartMs: number | null;
  serverStartClientMs: number | null;
  reanchorKey: string;
}

/** The optimistic assistant shell's key carries the client send time; the
 * thread-view merge keeps that key for the row's whole life (adoption never
 * remounts), so a live row's send moment stays readable after the real row
 * arrives. */
const PENDING_ASSISTANT_KEY = /^pending-assistant-(\d+)$/;

/**
 * Derive a row's thinking anchor from the facts the thread view already
 * carries. A row born from this client's send counts from the SEND moment
 * (the old `pendingMessage.timestamp` semantics — queue and first-chunk wait
 * included); a reloaded or history row falls back to its server creation
 * time mapped into the client frame.
 */
export function messageThinkingAnchor(
  message: Pick<ChatMessageItem, 'key' | 'createdAt'>,
  toClientEpoch: (serverMs: number) => number,
): ThinkingAnchor {
  const sentAt = PENDING_ASSISTANT_KEY.exec(message.key)?.[1];
  const clientStartMs = sentAt !== undefined ? Number(sentAt) : null;
  return {
    clientStartMs,
    // The pre-adoption shell's `createdAt` is already client-frame, so it
    // must never pass through the conversion — the client anchor covers that
    // row, and the fallback only ever sees real rows' server epochs.
    serverStartClientMs:
      clientStartMs !== null ? null : toClientEpoch(message.createdAt),
    reanchorKey: message.key,
  };
}

/**
 * Thinking-window timing for one assistant row. The anchor is derived from
 * the row, not from this mount, so the value is continuous across remounts
 * and INCLUDES the wait before the first reasoning/tool part arrived.
 *
 * `liveElapsedMs` ticks every second while `thinking`; `liveDurationMs`
 * latches the final value the instant thinking ends (useLayoutEffect, so the
 * summary paints "Thought for Ns" in one frame). Every reading of "now" goes
 * through `clientEpochNow()` from the clock authority (the sanctioned
 * raw-clock accessor) so this module never touches the wall clock directly.
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
    // No anchor yet: a stable client fallback so the timer can tick before
    // any anchor exists.
    if (clientFallbackRef.current === null) {
      clientFallbackRef.current = clientEpochNow();
    }
    return clientFallbackRef.current;
  }, [anchor, clientEpochNow]);

  // Lazy initial value so a timer that MOUNTS mid-thinking paints the correct
  // elapsed on its FIRST render (the header appears only once the first
  // reasoning/tool part lands, seconds after send; a plain `useState(null)`
  // would flash "Thinking" with no "· Ns"). Anchored to the row's own anchor,
  // so the value is continuous across the mount, not reset.
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

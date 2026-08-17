'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Client↔server clock authority.
 *
 * The chat UI must never subtract a SERVER epoch timestamp (`generationStartTime`,
 * a message `_creationTime`, `startedAt`) from a CLIENT `Date.now()`: the two
 * clocks differ by the network latency + wall-clock skew, which is ~0 on
 * localhost but seconds in production — the source of the "Thinking · Ns" timer
 * rewind and the message mis-order. This provider learns a coarse offset between
 * the two clocks from the reactive `serverNow` on `getThreadMeta` and on
 * the live `getGenerationText` object, and exposes conversions so every
 * live timer / relative-time computation runs in a SINGLE clock frame.
 *
 * This module is the ONE sanctioned home for raw `Date.now()` in the chat time
 * paths (the lint/source-walk guard bans it everywhere else and points here).
 *
 * Accuracy: `offsetMs = serverNow − Date.now()` at sample receipt. Because the
 * sample was stamped one downlink-latency before it arrived, this UNDERESTIMATES
 * the true skew by ~one-way latency (≈ half the round-trip) — a stable sub-second
 * residual, never a rewind. That is well within tolerance for second-granularity
 * timers and minute-granularity relative-time.
 */

/**
 * A new sample within this delta of the held offset is treated as latency
 * jitter, not a real re-sync, so the exposed offset (and every timer anchored
 * through it) stays put instead of wobbling on each reactive `getThreadMeta`
 * tick. 2s comfortably exceeds real RTT variance while still adopting a genuine
 * clock correction.
 */
const RESYNC_THRESHOLD_MS = 2_000;

export interface ClockOffset {
  /** `serverClock − clientClock` in ms (see module header for the ~half-RTT bias). */
  offsetMs: number;
  /** Map a SERVER-epoch timestamp into the CLIENT clock frame. */
  toClientEpoch: (serverMs: number) => number;
  /** "Now" in the SERVER clock frame (`Date.now() + offset`). */
  serverEpochNow: () => number;
  /** "Now" in the CLIENT clock frame (plain `Date.now()`). */
  clientEpochNow: () => number;
}

/** Identity offset — behaves exactly like raw `Date.now()`. Used outside a
 *  provider (SSR, tests, non-chat surfaces) and until the first sample lands. */
const DEFAULT_CLOCK_OFFSET: ClockOffset = {
  offsetMs: 0,
  toClientEpoch: (serverMs) => serverMs,
  serverEpochNow: () => Date.now(),
  clientEpochNow: () => Date.now(),
};

const ClockOffsetContext = createContext(DEFAULT_CLOCK_OFFSET);
const ReportServerNowContext = createContext<(serverNow?: number) => void>(
  () => undefined,
);

export function ClockOffsetProvider({ children }: { children: ReactNode }) {
  const [offsetMs, setOffsetMs] = useState(0);
  const hasSampleRef = useRef(false);
  const offsetRef = useRef(0);

  const report = useCallback((serverNow?: number) => {
    if (serverNow == null || !Number.isFinite(serverNow)) return;
    const candidate = serverNow - Date.now();
    // Adopt the first sample unconditionally; afterwards only a change beyond
    // the jitter threshold (a real re-sync), so unrelated getThreadMeta re-runs
    // (liveRoute flips, queued flag) never shift the timer frame.
    if (
      !hasSampleRef.current ||
      Math.abs(candidate - offsetRef.current) > RESYNC_THRESHOLD_MS
    ) {
      hasSampleRef.current = true;
      offsetRef.current = candidate;
      setOffsetMs(candidate);
    }
  }, []);

  const clock = useMemo<ClockOffset>(
    () => ({
      offsetMs,
      toClientEpoch: (serverMs: number) => serverMs - offsetMs,
      serverEpochNow: () => Date.now() + offsetMs,
      clientEpochNow: () => Date.now(),
    }),
    [offsetMs],
  );

  return (
    <ReportServerNowContext.Provider value={report}>
      <ClockOffsetContext.Provider value={clock}>
        {children}
      </ClockOffsetContext.Provider>
    </ReportServerNowContext.Provider>
  );
}

/** Read the client↔server clock conversions. Safe outside a provider (identity). */
export function useClockOffset(): ClockOffset {
  return useContext(ClockOffsetContext);
}

/**
 * Feed the reactive server clock in. Call from a subscriber that already
 * has a `serverNow` sample (`getThreadMeta`, or live `getGenerationText`)
 * — no new subscription. `undefined` samples (query loading / idle) are
 * ignored.
 */
export function useReportServerNow(serverNow?: number): void {
  const report = useContext(ReportServerNowContext);
  useEffect(() => {
    report(serverNow);
  }, [report, serverNow]);
}

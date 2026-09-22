import { useSyncExternalStore } from 'react';

/** How coarse the panel's clock is. Nothing here changes faster than this. */
const MINUTE_MS = 60_000;

/**
 * The wall clock, quantized to the minute.
 *
 * A countdown drawn from `Date.now()` during render is impure — React may
 * render twice and get two answers — and it never moves on its own, so a panel
 * left open shows the time it was opened. Reading the clock as an external
 * store fixes both: the snapshot is the minute rather than the instant, so it
 * is stable across renders inside one minute, and the subscription re-renders
 * the reader when the minute turns.
 */
function subscribe(onMinuteTurned: () => void): () => void {
  const timer = setInterval(onMinuteTurned, MINUTE_MS);
  return () => {
    clearInterval(timer);
  };
}

function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
}

export function useMinute(): number {
  return useSyncExternalStore(subscribe, currentMinute, currentMinute);
}

'use client';

import { useState, useSyncExternalStore } from 'react';

/**
 * One clock per interval, shared by every reader: a page with fifty live
 * durations runs one timer, not fifty, and they all tick on the same beat.
 */
interface Clock {
  now: number;
  readers: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
}

const clocks = new Map<number, Clock>();
const subscribers = new Map<number, (onTick: () => void) => () => void>();

function clockFor(intervalMs: number): Clock {
  let clock = clocks.get(intervalMs);
  if (clock === undefined) {
    clock = { now: Date.now(), readers: new Set(), timer: null };
    clocks.set(intervalMs, clock);
  }
  return clock;
}

/** One subscribe function per interval, so React keeps a reader subscribed
 *  across its renders instead of restarting the clock on each. */
function subscriberFor(intervalMs: number) {
  let subscribe = subscribers.get(intervalMs);
  if (subscribe === undefined) {
    subscribe = (onTick: () => void) => {
      const clock = clockFor(intervalMs);
      clock.readers.add(onTick);
      if (clock.timer === null) {
        // A reader that starts a clock starts it from the current time.
        clock.now = Date.now();
        clock.timer = setInterval(() => {
          clock.now = Date.now();
          for (const reader of clock.readers) reader();
        }, intervalMs);
      }
      return () => {
        clock.readers.delete(onTick);
        if (clock.readers.size === 0) {
          if (clock.timer !== null) clearInterval(clock.timer);
          clocks.delete(intervalMs);
        }
      };
    };
    subscribers.set(intervalMs, subscribe);
  }
  return subscribe;
}

const noSubscription = () => () => {};

/**
 * The current time (epoch ms), re-read every `intervalMs` (one second by
 * default) while `enabled`. Every reader of an interval shares one timer,
 * which stops when the last reader unmounts. Disabled — and on the server —
 * it answers the time of the first render and never re-renders.
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const interval = Math.max(16, Math.round(intervalMs));
  const [firstRender] = useState(() => Date.now());
  return useSyncExternalStore(
    enabled ? subscriberFor(interval) : noSubscription,
    enabled ? () => clockFor(interval).now : () => firstRender,
    () => firstRender,
  );
}

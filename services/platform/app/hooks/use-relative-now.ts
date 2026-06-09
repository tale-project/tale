'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useEffect, useState } from 'react';

import { formatRelativeTime } from '@/lib/utils/format/relative-time';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
/** Sub-minute ages are quantised to 5-second steps (0s → 5s → 10s …) so the
 *  label ticks in coarse, calm increments instead of jittering every second. */
const SECONDS_STEP_MS = 5 * SECOND_MS;

interface RelativeNowOptions {
  /**
   * Freeze updates and return `null`. Useful when the timer should be
   * hidden — e.g. while an AI reply is still streaming, where the timer
   * slot should disappear instead of ticking against a stale timestamp.
   */
  paused?: boolean;
}

/**
 * Live-updating short relative-time label ("1s", "2s", "1m", "3h"), formatted
 * for the row-of-list density used in the chat sidebar.
 *
 * Tick cadence is whatever the displayed unit needs:
 *   - elapsed <  1m: re-renders on each 5-second boundary (seconds shown in
 *     5s steps, so a per-second tick would be wasted work)
 *   - elapsed >= 1m: re-renders every minute (minute resolution is enough)
 *
 * For ages >= 1h the result falls through to `formatRelativeTime` so very
 * old rows pick up locale-specific narrow forms ("2h", "3d", "1w"…).
 *
 * Returns `null` when `paused` is true or `timestamp` is undefined so callers
 * can hide the slot entirely rather than render an empty string.
 */
export function useRelativeNow(
  timestamp: number | undefined,
  options?: RelativeNowOptions,
): string | null {
  const { locale } = useLocale();
  const paused = options?.paused === true;
  const [, setTick] = useState(0);

  useEffect(() => {
    if (paused || timestamp === undefined) return undefined;
    let handle: number;
    const schedule = () => {
      const diff = Math.max(0, Date.now() - timestamp);
      // Below a minute, wake exactly on the next 5s boundary so the label
      // flips precisely when its value changes; above, a per-minute tick.
      const next =
        diff < MINUTE_MS
          ? SECONDS_STEP_MS - (diff % SECONDS_STEP_MS)
          : MINUTE_MS;
      handle = window.setTimeout(() => {
        setTick((n) => n + 1);
        schedule();
      }, next);
    };
    schedule();
    return () => window.clearTimeout(handle);
  }, [paused, timestamp]);

  if (paused || timestamp === undefined) return null;

  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < MINUTE_MS) {
    // Quantise to 5-second steps: 0s, 5s, 10s … 55s. Floor (not round) so the
    // value never jumps ahead of the elapsed time.
    return `${Math.floor(diff / SECONDS_STEP_MS) * 5}s`;
  }
  if (diff < HOUR_MS) {
    return `${Math.floor(diff / MINUTE_MS)}m`;
  }
  return formatRelativeTime(timestamp, locale, 'narrow');
}

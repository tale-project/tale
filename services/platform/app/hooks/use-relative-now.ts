'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useEffect, useState } from 'react';

import { formatRelativeTime } from '@/lib/utils/format/relative-time';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

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
 *   - elapsed <  1m: re-renders every second (seconds visible)
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
      const next = diff < MINUTE_MS ? SECOND_MS : MINUTE_MS;
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
    // Clamp to 1s so the very first frame after a new timestamp doesn't
    // briefly show "0s" before the first tick lands.
    return `${Math.max(1, Math.floor(diff / SECOND_MS))}s`;
  }
  if (diff < HOUR_MS) {
    return `${Math.floor(diff / MINUTE_MS)}m`;
  }
  return formatRelativeTime(timestamp, locale, 'narrow');
}

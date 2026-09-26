'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useEffect, useState } from 'react';

import { useClockOffset } from '@/app/hooks/use-clock-offset';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * The quiet age at the end of a Home row: "now", "5m", "3h", "2d", then the
 * date once a week has passed. Narrow unit forms come from `Intl`, so each
 * locale abbreviates the way it reads naturally ("3 Std.", "3 h") — no
 * hand-rolled "h"/"d" suffixes.
 */
export function formatCompactAge(
  timestamp: number,
  now: number,
  locale: string,
): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < MINUTE_MS) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
      0,
      'second',
    );
  }
  const unit = (value: number, name: 'minute' | 'hour' | 'day') =>
    new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: name,
      unitDisplay: 'narrow',
    }).format(value);
  if (diff < HOUR_MS) return unit(Math.floor(diff / MINUTE_MS), 'minute');
  if (diff < DAY_MS) return unit(Math.floor(diff / HOUR_MS), 'hour');
  if (diff < WEEK_MS) return unit(Math.floor(diff / DAY_MS), 'day');
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: '2-digit' }),
  }).format(date);
}

/** {@link formatCompactAge}, re-rendering once a minute while on screen.
 * `null` when there is no timestamp or the caller pauses it (a reply that is
 * still being written shows its own state instead of an age). */
export function useCompactAge(
  timestamp: number | undefined,
  options?: { paused?: boolean },
): string | null {
  const { locale } = useLocale();
  const { serverEpochNow } = useClockOffset();
  const paused = options?.paused === true;
  const [, setTick] = useState(0);

  useEffect(() => {
    if (paused || timestamp === undefined) return undefined;
    const handle = window.setInterval(() => setTick((n) => n + 1), MINUTE_MS);
    return () => window.clearInterval(handle);
  }, [paused, timestamp]);

  if (paused || timestamp === undefined) return null;
  return formatCompactAge(timestamp, serverEpochNow(), locale);
}

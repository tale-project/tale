'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useEffect, useState } from 'react';

import { useClockOffset } from '@/app/hooks/use-clock-offset';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
/** The longest delay `setTimeout` keeps; a longer one fires at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** Building an `Intl` formatter costs far more than using one, and a Home
 * list formats an age for every row it renders — so each locale's formatter
 * is built once and kept. */
const formatters = new Map<
  string,
  Intl.RelativeTimeFormat | Intl.NumberFormat | Intl.DateTimeFormat
>();

function formatter<
  F extends Intl.RelativeTimeFormat | Intl.NumberFormat | Intl.DateTimeFormat,
>(key: string, build: () => F): F {
  const known = formatters.get(key);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each key is only ever stored by the builder of its own formatter type
  if (known !== undefined) return known as F;
  const built = build();
  formatters.set(key, built);
  return built;
}

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
    return formatter(
      `relative|${locale}`,
      () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
    ).format(0, 'second');
  }
  const unit = (value: number, name: 'minute' | 'hour' | 'day') =>
    formatter(
      `unit|${name}|${locale}`,
      () =>
        new Intl.NumberFormat(locale, {
          style: 'unit',
          unit: name,
          unitDisplay: 'narrow',
        }),
    ).format(value);
  if (diff < HOUR_MS) return unit(Math.floor(diff / MINUTE_MS), 'minute');
  if (diff < DAY_MS) return unit(Math.floor(diff / HOUR_MS), 'hour');
  if (diff < WEEK_MS) return unit(Math.floor(diff / DAY_MS), 'day');
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return formatter(
    `date|${sameYear ? 'year' : 'other'}|${locale}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        ...(sameYear ? {} : { year: '2-digit' }),
      }),
  ).format(date);
}

/**
 * How long until {@link formatCompactAge} reads differently: the next
 * minute, hour or day boundary while it counts, the next New Year once it
 * shows a date (the year joins it then).
 */
export function msUntilCompactAgeChanges(
  timestamp: number,
  now: number,
): number {
  const diff = Math.max(0, now - timestamp);
  if (diff < MINUTE_MS) return MINUTE_MS - diff;
  if (diff < HOUR_MS) return MINUTE_MS - (diff % MINUTE_MS);
  if (diff < DAY_MS) return HOUR_MS - (diff % HOUR_MS);
  if (diff < WEEK_MS) return DAY_MS - (diff % DAY_MS);
  const year = new Date(now).getFullYear();
  return new Date(year + 1, 0, 1).getTime() - now;
}

/** {@link formatCompactAge}, re-rendering when its label changes — not every
 * minute: a row three days old reads "3d" until tomorrow, and a list of
 * hundreds of rows woke each of them every minute for nothing.
 * `null` when there is no timestamp or the caller pauses it (a reply that is
 * still being written shows its own state instead of an age). */
export function useCompactAge(
  timestamp: number | undefined,
  options?: { paused?: boolean },
): string | null {
  const { locale } = useLocale();
  const { serverEpochNow } = useClockOffset();
  const paused = options?.paused === true;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (paused || timestamp === undefined) return undefined;
    const wait = msUntilCompactAgeChanges(timestamp, serverEpochNow());
    // A wait past the timer's range re-checks at its end instead.
    const handle = window.setTimeout(
      () => setTick((n) => n + 1),
      Math.min(wait + 1, MAX_TIMER_MS),
    );
    return () => window.clearTimeout(handle);
  }, [paused, timestamp, tick, serverEpochNow]);

  if (paused || timestamp === undefined) return null;
  return formatCompactAge(timestamp, serverEpochNow(), locale);
}

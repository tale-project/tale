'use client';

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useNow } from '../../hooks/use-now';
import { cn } from '../../lib/cn';
import {
  durationIso,
  formatDuration,
  type FormatDurationOptions,
} from '../../lib/format-duration';

export {
  durationIso,
  formatDuration,
  type DurationStyle,
  type FormatDurationOptions,
} from '../../lib/format-duration';
export { useNow } from '../../hooks/use-now';

/** The reader's language, as the package's other formatters read it. */
function useReaderLocale(): string {
  const { i18n } = useTranslation();
  return i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
}

/**
 * `formatDuration` in the reader's language: `(ms, options) => words`.
 */
export function useFormatDuration(): (
  ms: number,
  options?: FormatDurationOptions,
) => string {
  const locale = useReaderLocale();
  return useCallback(
    (ms: number, options?: FormatDurationOptions) =>
      formatDuration(ms, locale, options),
    [locale],
  );
}

export interface DurationProps {
  /** A span that is over: how long a step took. */
  ms?: number;
  /** When a span still open began (epoch ms): "running for 12 sec". */
  since?: number;
  /** With `since`, keep counting, once a second. */
  live?: boolean;
  /** How units are written: `formatDuration`'s `style` ("3m 12s", "3 min,
   *  12 sec", "3 minutes, 12 seconds"). */
  unitDisplay?: FormatDurationOptions['style'];
  maxUnits?: FormatDurationOptions['maxUnits'];
  className?: string;
}

/**
 * A duration as a `<time>` element: the words in the reader's language and
 * the exact span in `dateTime`. Pass `ms` for a span that is over, or
 * `since` for one still open — with `live` it counts on, once a second, on
 * a clock every live duration on the page shares. Its text changes quietly
 * (`aria-live="off"`): a ticking counter would talk over everything else.
 */
export function Duration({
  ms,
  since,
  live = false,
  unitDisplay,
  maxUnits,
  className,
}: DurationProps) {
  const format = useFormatDuration();
  const now = useNow(1000, live && ms === undefined && since !== undefined);
  const span = ms ?? (since === undefined ? undefined : now - since);
  if (span === undefined) return null;
  return (
    <time
      dateTime={durationIso(span)}
      aria-live="off"
      className={cn('tabular-nums', className)}
    >
      {format(span, { style: unitDisplay, maxUnits })}
    </time>
  );
}

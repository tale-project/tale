const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/**
 * Locale-aware relative time ("3 min ago", "2 hr ago", "in 5 days").
 * `style: 'narrow'` produces the most compact form per locale (e.g. "3m ago"
 * in en); `'long'` produces the spelled-out form. Picks the largest unit that
 * fits, falling back to seconds for sub-minute deltas.
 *
 * `nowMs` is "now" in the SAME clock frame as `date` — pass `serverEpochNow()`
 * from `useClockOffset` when `date` is a server `_creationTime`, so the delta is
 * never a client wall clock minus a server epoch (which skews "just now" into
 * "in 3s"/"5s ago" under real clock offset). Required so the frame is explicit
 * at every call site.
 */
export function formatRelativeTime(
  date: Date | number,
  locale: string,
  nowMs: number,
  style: 'long' | 'short' | 'narrow' = 'long',
): string {
  const ms = typeof date === 'number' ? date : date.getTime();
  const diffSeconds = (ms - nowMs) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale || undefined, {
    numeric: 'auto',
    style,
  });
  for (const [unit, secondsPerUnit] of RELATIVE_UNITS) {
    if (Math.abs(diffSeconds) >= secondsPerUnit || unit === 'second') {
      return rtf.format(Math.round(diffSeconds / secondsPerUnit), unit);
    }
  }
  return '';
}

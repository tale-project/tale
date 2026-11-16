/**
 * Split a thread's entries into days, for one `ThreadDayDivider` each.
 *
 * Entries must already be in reading order; consecutive entries of the same
 * day form one group, so the order is kept exactly. A day reads in the
 * browser's local time zone by default — the zone `useFormatDate` formats
 * the divider's label in — so an entry never sits under the wrong day's pill.
 */

export interface ThreadDay<T> {
  /** The day's key: `dayKey` of its first entry. */
  key: string;
  /** The first entry's time, for the divider's label. */
  at: number;
  entries: T[];
}

/** The local calendar day of an instant, as `YYYY-M-D`. */
export function localDayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function groupByDay<T>(
  entries: readonly T[],
  getAt: (entry: T) => number,
  dayKey: (at: number) => string = localDayKey,
): ThreadDay<T>[] {
  const days: ThreadDay<T>[] = [];
  for (const entry of entries) {
    const at = getAt(entry);
    const key = dayKey(at);
    const day = days.at(-1);
    if (day !== undefined && day.key === key) day.entries.push(entry);
    else days.push({ key, at, entries: [entry] });
  }
  return days;
}

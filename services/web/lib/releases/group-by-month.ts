import type { Release } from '@/lib/releases/types';

export interface ReleaseMonthGroup {
  /** Sort key `YYYY-MM`. */
  key: string;
  /** Localized month label supplied by the caller. */
  label: string;
  releases: Release[];
}

/**
 * Group newest-first releases into calendar months (UTC).
 * `formatMonth(year, monthIndex0)` returns the visible label.
 */
export function groupReleasesByMonth(
  releases: readonly Release[],
  formatMonth: (year: number, monthIndex0: number) => string,
): ReleaseMonthGroup[] {
  const buckets = new Map<string, Release[]>();
  for (const release of releases) {
    const d = release.publishedAt ? new Date(release.publishedAt) : null;
    const year = d && !Number.isNaN(d.getTime()) ? d.getUTCFullYear() : 0;
    const month = d && !Number.isNaN(d.getTime()) ? d.getUTCMonth() : 0;
    const key =
      year === 0 ? 'unknown' : `${year}-${String(month + 1).padStart(2, '0')}`;
    const list = buckets.get(key) ?? [];
    list.push(release);
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, list]) => {
      if (key === 'unknown') {
        return { key, label: '', releases: list };
      }
      const [y, m] = key.split('-').map(Number);
      return {
        key,
        label: formatMonth(y, m - 1),
        releases: list,
      };
    });
}

export function releaseDayOfMonth(publishedAt: string | null): string {
  if (!publishedAt) return '—';
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return '—';
  return String(d.getUTCDate());
}

export function formatReleaseDate(
  publishedAt: string | null,
  locale: string,
): string {
  if (!publishedAt) return '';
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

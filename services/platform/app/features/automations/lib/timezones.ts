import { canonicalTimeZone } from '@/lib/shared/zoned-time';

/**
 * The time zones a trigger's schedule can read in, as its Time zone field
 * offers them.
 */

/**
 * Whether `timezone` names a zone — the check the trigger schema makes
 * (`timeZoneSchema`), so the field refuses `Mars/Olympus` or a blank zone
 * before the save does.
 */
export function isValidTimezone(timezone: string): boolean {
  return canonicalTimeZone(timezone) !== null;
}

/** The zones `Intl` knows, or a short list where it cannot say. */
function supportedZones(): readonly string[] {
  if (
    typeof Intl !== 'undefined' &&
    'supportedValuesOf' in Intl &&
    typeof Intl.supportedValuesOf === 'function'
  ) {
    return Intl.supportedValuesOf('timeZone');
  }
  return [
    'Europe/Zurich',
    'Europe/Berlin',
    'Europe/London',
    'America/New_York',
    'America/Los_Angeles',
    'Asia/Tokyo',
  ];
}

/**
 * The zones the field offers: UTC first, then the reader's own zone, then
 * every other zone by name. `extra` (the stored or typed zone) is always
 * among them, so a zone `Intl` does not list still shows as chosen.
 */
export function listTimezoneOptions(
  extra?: string,
  viewerZone?: string,
): string[] {
  const set = new Set<string>(['UTC', ...supportedZones()]);
  const pinned = viewerZone?.trim() ?? '';
  if (pinned !== '') set.add(pinned);
  if (extra !== undefined && extra.trim() !== '') set.add(extra.trim());
  const rank = (zone: string): number => {
    if (zone === 'UTC') return 0;
    if (zone === pinned) return 1;
    return 2;
  };
  return [...set].toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Timezone list + browser default for the schedule dialog's timezone picker
 * (#2667) — the dialog used to hardcode `timezone: 'UTC'` on both create and
 * update, silently resetting any previously-chosen zone back to UTC on every
 * save. `browserTimezone` mirrors the same `Intl` idiom `useFormatDate`
 * already uses for the app's own date rendering.
 */

/** The IANA zone identifiers this runtime knows, sorted for a stable,
 *  readable list. Falls back to `['UTC']` on a host without
 *  `Intl.supportedValuesOf` (older engines) so the picker never renders
 *  empty. Always includes `'UTC'` itself — some ICU builds omit the literal
 *  alias from the enumeration even though `Intl.DateTimeFormat` accepts it,
 *  and every legacy schedule row defaults to it (`wfSchedulesTable.timezone`),
 *  so the picker must always be able to select/display it. */
export function listTimezones(): string[] {
  const zones = new Set(
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [],
  );
  zones.add('UTC');
  return [...zones].sort();
}

/** The zone's current UTC offset (`GMT+1`, `GMT-05:00`), or the zone name
 *  itself if `Intl` can't resolve it (defensive — should not happen for any
 *  value `listTimezones` returns). */
function utcOffsetLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
  } catch (err) {
    console.warn(
      `[timezone-options] could not resolve offset for ${timeZone}:`,
      err,
    );
    return timeZone;
  }
}

export interface TimezoneOption {
  value: string;
  label: string;
}

/** Select options for every known IANA zone, labelled with its current UTC
 *  offset (`Europe/Paris (GMT+1)`) so the operator can eyeball the right one
 *  without memorizing zone names. */
export function listTimezoneOptions(): TimezoneOption[] {
  return listTimezones().map((tz) => ({
    value: tz,
    label: `${tz} (${utcOffsetLabel(tz)})`,
  }));
}

/** The browser's own zone — the schedule dialog's create-time default (org
 *  and browser zone coincide in practice; there is no per-org timezone
 *  setting in the product yet). Falls back to `'UTC'` on failure. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (err) {
    console.warn(
      '[timezone-options] could not resolve the browser timezone:',
      err,
    );
    return 'UTC';
  }
}

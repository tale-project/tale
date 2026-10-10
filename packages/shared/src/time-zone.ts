/**
 * Time zone names as every surface reads them: the trigger schema that
 * refuses a zone nobody can resolve, the platform's zoned clock and the
 * scan that fires a schedule in it. One spelling per zone, so a stored zone
 * compares equal however it was typed.
 *
 * Imports nothing: the browser and the server both load it.
 */

/**
 * The zone `value` names, trimmed and spelled the way `Intl` spells it
 * (`utc` → `UTC`, `europe/zurich` → `Europe/Zurich`), or null when it names
 * none — a blank value included. Fixed offsets such as `+05:30` are zones
 * too. Runtimes differ on links: Bun keeps `US/Eastern` where Node answers
 * `America/New_York`; both are valid everywhere.
 */
export function canonicalTimeZone(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: trimmed,
    }).resolvedOptions().timeZone;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

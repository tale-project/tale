import dayjs from 'dayjs';

/**
 * How long a new API key lives, and when it stops working.
 *
 * Better Auth's api-key plugin takes the lifetime as `expiresIn` seconds and
 * holds it to between one day and its `keyExpiration.maxExpiresIn` default
 * of 365 days (`backend/auth/auth.ts` sets no override). Presets are elapsed
 * days. Custom dates use the viewer's calendar, whose days may be shorter
 * or longer when the UTC offset changes.
 */

/** The longest lifetime a key may be given, in days. */
const API_KEY_MAX_EXPIRY_DAYS = 365;

/** The lifetimes the form offers as one choice each, in days. */
export const API_KEY_EXPIRY_PRESET_DAYS = [7, 30, 90, 365] as const;

/** Every choice the form offers, in the order it lists them. */
export const API_KEY_EXPIRY_CHOICES = [
  '7',
  '30',
  '90',
  '365',
  'custom',
  'never',
] as const;

export type ApiKeyExpiryChoice = (typeof API_KEY_EXPIRY_CHOICES)[number];

export function isApiKeyExpiryChoice(
  value: string,
): value is ApiKeyExpiryChoice {
  return (API_KEY_EXPIRY_CHOICES as readonly string[]).includes(value);
}

/** What the form starts at. */
export const DEFAULT_API_KEY_EXPIRY: ApiKeyExpiryChoice = '30';

/** The date the calendar opens on when "Custom date" is chosen. */
export const DEFAULT_CUSTOM_EXPIRY_DAYS = 30;

const DAY_MS = 86_400_000;

/** Local dates that contain an instant within the provider's interval. */
export function customExpiryBounds(now: number): {
  minDate: number;
  maxDate: number;
} {
  return {
    minDate: dayjs(now + DAY_MS)
      .startOf('day')
      .valueOf(),
    maxDate: dayjs(now + API_KEY_MAX_EXPIRY_DAYS * DAY_MS)
      .startOf('day')
      .valueOf(),
  };
}

/**
 * Lifetime in seconds: null means never; undefined means an unavailable
 * custom date. Keep the local clock time where possible, then constrain it
 * to the provider interval only if the result stays on the selected day.
 */
export function expirySeconds(
  choice: ApiKeyExpiryChoice,
  customDate: number | null,
  now: number,
): number | null | undefined {
  if (choice === 'never') return null;
  if (choice === 'custom') {
    if (customDate === null || !Number.isFinite(customDate)) return undefined;
    const picked = dayjs(customDate);
    const clock = dayjs(now);
    const target = picked
      .hour(clock.hour())
      .minute(clock.minute())
      .second(clock.second())
      .millisecond(clock.millisecond())
      .valueOf();
    const expiresAt = Math.max(
      now + DAY_MS,
      Math.min(target, now + API_KEY_MAX_EXPIRY_DAYS * DAY_MS),
    );
    if (!picked.isSame(expiresAt, 'day')) return undefined;
    return (expiresAt - now) / 1000;
  }
  return Number(choice) * 86_400;
}

/** Whether a custom date lies in the window the plugin accepts. */
export function isCustomExpiryInRange(date: number, now: number): boolean {
  return expirySeconds('custom', date, now) !== undefined;
}

/** When a key made at `now` that lives `seconds` expires — the instant the
 * plugin stores, `now` plus the lifetime in seconds. */
export function expiresAtAfter(seconds: number, now: number): number {
  return now + seconds * 1000;
}

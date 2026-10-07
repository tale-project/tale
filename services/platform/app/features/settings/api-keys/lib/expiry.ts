import dayjs from 'dayjs';

/**
 * How long a new API key lives, and when it stops working.
 *
 * Better Auth's api-key plugin takes the lifetime as `expiresIn` seconds and
 * holds it to between one day and its `keyExpiration.maxExpiresIn` default
 * of 365 days (`backend/auth/auth.ts` sets no override). Every choice here is
 * a whole number of days from now — a preset, or a date picked in the
 * calendar — so a key expires at the time of day it was created, on the day
 * the form named.
 */

/** The longest lifetime a key may be given, in days. */
export const API_KEY_MAX_EXPIRY_DAYS = 365;

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

/** Whole calendar days from `now`'s day to `date`'s, in the viewer's zone. */
export function daysUntil(date: number, now: number): number {
  return dayjs(date).startOf('day').diff(dayjs(now).startOf('day'), 'day');
}

/** The first and last day a custom expiry may name: tomorrow, and a year
 * from today. */
export function customExpiryBounds(now: number): {
  minDate: number;
  maxDate: number;
} {
  const today = dayjs(now).startOf('day');
  return {
    minDate: today.add(1, 'day').valueOf(),
    maxDate: today.add(API_KEY_MAX_EXPIRY_DAYS, 'day').valueOf(),
  };
}

/**
 * The days a key made at `now` lives: `null` for one that never expires,
 * `undefined` while "Custom date" has no date picked.
 */
export function expiryDays(
  choice: ApiKeyExpiryChoice,
  customDate: number | null,
  now: number,
): number | null | undefined {
  if (choice === 'never') return null;
  if (choice === 'custom') {
    return customDate === null ? undefined : daysUntil(customDate, now);
  }
  return Number(choice);
}

/** Whether a custom date lies in the window the plugin accepts. */
export function isCustomExpiryInRange(date: number, now: number): boolean {
  const days = daysUntil(date, now);
  return days >= 1 && days <= API_KEY_MAX_EXPIRY_DAYS;
}

/** The `expiresIn` the create call sends — absent for a key that never
 * expires. */
export function expiresInSeconds(days: number | null): number | undefined {
  return days === null ? undefined : days * 86_400;
}

/** When a key made at `now` that lives `days` expires — the instant the
 * plugin stores, `now` plus the lifetime in seconds. */
export function expiresAtAfter(days: number, now: number): number {
  return now + days * DAY_MS;
}

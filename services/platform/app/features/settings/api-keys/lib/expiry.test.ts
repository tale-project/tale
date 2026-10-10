import { describe, expect, it } from 'vitest';

import {
  customExpiryBounds,
  daysUntil,
  expiresAtAfter,
  expiresInSeconds,
  expiryDays,
  isCustomExpiryInRange,
} from './expiry';

// 2026-10-07 17:30 local: late in the day, so a whole-day count that read
// the clock instead of the calendar would come out one short.
const NOW = new Date(2026, 9, 7, 17, 30).getTime();
const day = (month: number, date: number, year = 2026) =>
  new Date(year, month, date).getTime();

describe('API key expiry', () => {
  it('counts calendar days from today to the picked day', () => {
    expect(daysUntil(day(9, 8), NOW)).toBe(1);
    expect(daysUntil(day(10, 6), NOW)).toBe(30);
    expect(daysUntil(day(9, 7), NOW)).toBe(0);
  });

  it('offers tomorrow through a year from today, the window the plugin accepts [APIKEY-R10]', () => {
    const { minDate, maxDate } = customExpiryBounds(NOW);
    expect(minDate).toBe(day(9, 8));
    expect(maxDate).toBe(day(9, 7, 2027));
    expect(isCustomExpiryInRange(minDate, NOW)).toBe(true);
    expect(isCustomExpiryInRange(maxDate, NOW)).toBe(true);
    expect(isCustomExpiryInRange(day(9, 7), NOW)).toBe(false);
    expect(isCustomExpiryInRange(day(9, 8, 2027), NOW)).toBe(false);
  });

  it('turns every choice into a lifetime in days', () => {
    expect(expiryDays('30', null, NOW)).toBe(30);
    expect(expiryDays('365', null, NOW)).toBe(365);
    expect(expiryDays('never', null, NOW)).toBeNull();
    expect(expiryDays('custom', day(9, 21), NOW)).toBe(14);
    // "Custom date" with no day picked has no lifetime yet.
    expect(expiryDays('custom', null, NOW)).toBeUndefined();
  });

  it('sends whole days as seconds, and nothing for a key that never expires', () => {
    expect(expiresInSeconds(30)).toBe(2_592_000);
    expect(expiresInSeconds(365)).toBe(31_536_000);
    expect(expiresInSeconds(null)).toBeUndefined();
  });

  it('dates the expiry the way the plugin stores it: now plus the lifetime', () => {
    expect(expiresAtAfter(14, NOW)).toBe(NOW + 14 * 86_400_000);
  });
});

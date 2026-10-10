import { beforeAll, describe, expect, it } from 'vitest';

import { loadDayjsLocale } from './dayjs-setup';
import { formatDate, localTimeZone } from './format';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('formatDate', () => {
  describe('the relative preset', () => {
    // `fromNow` measures against the real clock, so the fixture has to as well.
    const inFiveDays = new Date(Date.now() + 5 * DAY_MS);

    beforeAll(async () => {
      // Locales register lazily; without this every assertion below would be
      // testing the eagerly loaded `en` data under another locale's name.
      await loadDayjsLocale('de');
    });

    it('names the direction', () => {
      expect(formatDate(inFiveDays, { preset: 'relative', locale: 'en' })).toBe(
        'in 5 days',
      );
    });

    it('leaves the direction out when the caller supplies it', () => {
      // A label like "Resets in" already says which way the clock runs, and a
      // second "in" inside the value would read twice.
      expect(
        formatDate(inFiveDays, {
          preset: 'relative',
          locale: 'en',
          withoutSuffix: true,
        }),
      ).toBe('5 days');
    });

    it('declines the bare distance the way the locale wants it', () => {
      // German inflects for the suffix: "in 5 Tagen" takes the dative, the
      // bare distance the nominative. dayjs's own locale data does this, which
      // is why a caller must never staple its own preposition onto the
      // suffixed form.
      expect(formatDate(inFiveDays, { preset: 'relative', locale: 'de' })).toBe(
        'in 5 Tagen',
      );
      expect(
        formatDate(inFiveDays, {
          preset: 'relative',
          locale: 'de',
          withoutSuffix: true,
        }),
      ).toBe('5 Tage');
    });
  });

  describe('the timezone option', () => {
    // 23:30 UTC on 5 October is already the 6th in Tokyo (UTC+9).
    const instant = new Date(Date.UTC(2026, 9, 5, 23, 30));

    it('reads the same in the runtime zone, named or not', () => {
      // Converting into the zone a date already reads in is skipped (it cost
      // an ICU formatter per call); the words must not change for it.
      for (const preset of ['short', 'medium', 'long', 'time'] as const) {
        expect(
          formatDate(instant, {
            preset,
            locale: 'en',
            timezone: localTimeZone(),
          }),
        ).toBe(formatDate(instant, { preset, locale: 'en' }));
      }
    });

    it('still converts into another zone', () => {
      expect(
        formatDate(instant, {
          preset: 'long',
          locale: 'en',
          timezone: 'Asia/Tokyo',
        }),
      ).toBe('October 6, 2026 8:30 AM');
      expect(
        formatDate(instant, { preset: 'long', locale: 'en', timezone: 'UTC' }),
      ).toBe('October 5, 2026 11:30 PM');
    });
  });
});

import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import { initServiceI18n } from '../../i18n/init-service';
import { uiMessages } from '../../i18n/messages';
import {
  formatOccurrence,
  formatSchedule,
  formatScheduleCompact,
  formatWeekdaySet,
  formatZonedDate,
  formatZonedTime,
  weekdayName,
} from './format';
import type { ScheduleRule } from './schedule';

let i18n: ReturnType<typeof initServiceI18n>;
beforeAll(() => {
  i18n = initServiceI18n({
    bundles: { en: {}, de: {}, fr: {} },
    regional: {},
    packages: [uiMessages],
  });
});

function tFor(locale: string): TFunction {
  return i18n.getFixedT(locale, 'recurrence');
}

/** Engines differ on the space before AM/PM (U+0020 in Node, U+202F in
 *  Chromium) and French uses no-break spaces: compare words, not spaces. */
function plain(text: string): string {
  return text.replace(/[\s  ]+/g, ' ');
}

const sentence = (rule: ScheduleRule, locale: string) =>
  plain(formatSchedule(rule, tFor(locale), locale));

const compact = (rule: ScheduleRule, locale: string) => {
  const label = formatScheduleCompact(rule, tFor(locale), locale);
  return plain(
    label.tail === undefined ? label.head : `${label.head} · ${label.tail}`,
  );
};

/** The short weekday name ICU writes ("Di" or "Di.", "mar."). */
const short = (day: number, locale: string) =>
  weekdayName(day, locale, 'short');

const WORKWEEK = [1, 2, 3, 4, 5];

/** The design's worked examples: en on a 12-hour clock, de and fr on 24. */
const EXAMPLES: {
  rule: ScheduleRule;
  en: [string, string];
  de: [string, string];
  fr: [string, string];
}[] = [
  {
    rule: { frequency: 'daily', interval: 1, times: ['09:00'] },
    en: ['Daily at 9:00 AM', 'Daily · 9:00 AM'],
    de: ['Täglich um 09:00 Uhr', 'Täglich · 09:00'],
    fr: ['Tous les jours à 09:00', 'Tous les jours · 09:00'],
  },
  {
    rule: {
      frequency: 'weekly',
      interval: 1,
      weekdays: WORKWEEK,
      times: ['09:00', '17:30'],
    },
    en: ['Every weekday at 9:00 AM and 5:30 PM', 'Weekdays · 9:00 AM, 5:30 PM'],
    de: ['Jeden Werktag um 09:00 und 17:30 Uhr', 'Werktags · 09:00, 17:30'],
    fr: [
      'Tous les jours ouvrés à 09:00 et 17:30',
      'Jours ouvrés · 09:00, 17:30',
    ],
  },
  {
    rule: { frequency: 'weekly', interval: 2, weekdays: [1], times: ['08:00'] },
    en: [
      'Every 2 weeks on Monday at 8:00 AM',
      'Every 2 weeks · Mon at 8:00 AM',
    ],
    de: [
      'Alle 2 Wochen am Montag um 08:00 Uhr',
      `Alle 2 Wochen · ${short(1, 'de')} um 08:00`,
    ],
    fr: [
      'Toutes les 2 semaines le lundi à 08:00',
      `Toutes les 2 semaines · ${short(1, 'fr')} à 08:00`,
    ],
  },
  {
    rule: { frequency: 'monthly', interval: 1, monthDay: 1, times: ['06:00'] },
    en: ['Monthly on day 1 at 6:00 AM', 'Monthly · day 1 at 6:00 AM'],
    de: ['Monatlich am 1. um 06:00 Uhr', 'Monatlich · 1. um 06:00'],
    fr: ['Chaque mois le 1er à 06:00', 'Tous les mois · le 1er à 06:00'],
  },
  {
    rule: {
      frequency: 'daily',
      interval: 1,
      times: ['15:00', '06:00', '12:00', '09:00'],
    },
    en: ['Daily at 6:00 AM, 9:00 AM, 12:00 PM, and 3:00 PM', 'Daily · 4 times'],
    de: ['Täglich um 06:00, 09:00, 12:00 und 15:00 Uhr', 'Täglich · 4-mal'],
    fr: [
      'Tous les jours à 06:00, 09:00, 12:00 et 15:00',
      'Tous les jours · 4 fois',
    ],
  },
  {
    rule: { frequency: 'minutely', interval: 15 },
    en: ['Every 15 minutes', 'Every 15 minutes'],
    de: ['Alle 15 Minuten', 'Alle 15 Minuten'],
    fr: ['Toutes les 15 minutes', 'Toutes les 15 minutes'],
  },
  {
    rule: {
      frequency: 'minutely',
      interval: 15,
      window: { weekdays: WORKWEEK, hours: { from: '08:00', to: '18:00' } },
    },
    en: [
      'Every 15 minutes, Mon–Fri, 8:00 AM–6:00 PM',
      'Every 15 minutes · Mon–Fri, 8:00 AM–6:00 PM',
    ],
    de: [
      'Alle 15 Minuten, Mo–Fr, 08:00–18:00 Uhr',
      'Alle 15 Minuten · Mo–Fr, 08:00–18:00',
    ],
    fr: [
      'Toutes les 15 minutes, lun.–ven., de 08:00 à 18:00',
      'Toutes les 15 minutes · lun.–ven., 08:00–18:00',
    ],
  },
  {
    rule: {
      frequency: 'minutely',
      interval: 30,
      window: {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        hours: { from: '22:00', to: '06:00' },
      },
    },
    en: [
      'Every 30 minutes, 10:00 PM–6:00 AM',
      'Every 30 minutes · 10:00 PM–6:00 AM',
    ],
    de: ['Alle 30 Minuten, 22:00–06:00 Uhr', 'Alle 30 Minuten · 22:00–06:00'],
    fr: [
      'Toutes les 30 minutes, de 22:00 à 06:00',
      'Toutes les 30 minutes · 22:00–06:00',
    ],
  },
  {
    rule: { frequency: 'hourly', interval: 1, minute: 0 },
    en: ['Every hour', 'Every hour'],
    de: ['Stündlich', 'Stündlich'],
    fr: ['Toutes les heures', 'Toutes les heures'],
  },
  {
    rule: { frequency: 'hourly', interval: 6, minute: 0 },
    en: ['Every 6 hours', 'Every 6 hours'],
    de: ['Alle 6 Stunden', 'Alle 6 Stunden'],
    fr: ['Toutes les 6 heures', 'Toutes les 6 heures'],
  },
  {
    rule: {
      frequency: 'hourly',
      interval: 2,
      minute: 15,
      window: { weekdays: WORKWEEK },
    },
    en: [
      'Every 2 hours at 15 minutes past the hour, Mon–Fri',
      'Every 2 hours · :15, Mon–Fri',
    ],
    de: [
      'Alle 2 Stunden, 15 Minuten nach der vollen Stunde, Mo–Fr',
      'Alle 2 Stunden · :15, Mo–Fr',
    ],
    fr: [
      'Toutes les 2 heures, 15 minutes après l’heure pile, lun.–ven.',
      'Toutes les 2 heures · :15, lun.–ven.',
    ],
  },
];

describe.each(['en', 'de', 'fr'] as const)('schedules in %s', (locale) => {
  it.each(
    EXAMPLES.map((example) => [JSON.stringify(example.rule), example] as const),
  )('words %s as the design does', (_name, example) => {
    const [expectedSentence, expectedCompact] = example[locale];
    expect(sentence(example.rule, locale)).toBe(plain(expectedSentence));
    expect(compact(example.rule, locale)).toBe(plain(expectedCompact));
  });
});

describe('the weekly example with a day tail', () => {
  it('lists the days and the time in each language', () => {
    const rule: ScheduleRule = {
      frequency: 'weekly',
      interval: 1,
      weekdays: [4, 2],
      times: ['09:00'],
    };
    expect(sentence(rule, 'en')).toBe(
      'Weekly on Tuesday and Thursday at 9:00 AM',
    );
    expect(compact(rule, 'en')).toBe('Weekly · Tue, Thu at 9:00 AM');
    expect(sentence(rule, 'de')).toBe(
      'Wöchentlich am Dienstag und Donnerstag um 09:00 Uhr',
    );
    expect(compact(rule, 'de')).toBe(
      `Wöchentlich · ${short(2, 'de')}, ${short(4, 'de')} um 09:00`,
    );
    expect(sentence(rule, 'fr')).toBe(
      'Chaque semaine le mardi et jeudi à 09:00',
    );
    expect(compact(rule, 'fr')).toBe(
      plain(`Chaque semaine · ${short(2, 'fr')}, ${short(4, 'fr')} à 09:00`),
    );
  });

  it('counts three times or more after the days', () => {
    const rule: ScheduleRule = {
      frequency: 'weekly',
      interval: 1,
      weekdays: [2, 4],
      times: ['08:00', '12:00', '16:00'],
    };
    expect(compact(rule, 'en')).toBe('Weekly · Tue, Thu, 3 times');
  });
});

describe('hour cycles', () => {
  const rule: ScheduleRule = {
    frequency: 'minutely',
    interval: 15,
    window: { weekdays: WORKWEEK, hours: { from: '08:00', to: '18:00' } },
  };

  it('writes German on a 12-hour clock without "Uhr" when the host asks', () => {
    const text = plain(formatSchedule(rule, tFor('de'), 'de', 12));
    expect(text).toMatch(/^Alle 15 Minuten, Mo–Fr, 0?8:00 AM–0?6:00 PM$/);
    expect(
      plain(
        formatSchedule(
          { frequency: 'daily', interval: 1, times: ['17:00'] },
          tFor('de'),
          'de',
          12,
        ),
      ),
    ).toMatch(/^Täglich um 0?5:00 PM$/);
  });

  it('writes English on a 24-hour clock when the host asks', () => {
    expect(plain(formatSchedule(rule, tFor('en'), 'en', 24))).toBe(
      'Every 15 minutes, Mon–Fri, 08:00–18:00',
    );
  });

  it('reads a window until midnight as ending at midnight', () => {
    expect(
      sentence(
        {
          frequency: 'minutely',
          interval: 30,
          window: { weekdays: [5], hours: { from: '18:00', to: '00:00' } },
        },
        'de',
      ),
    ).toBe(`Alle 30 Minuten, ${short(5, 'de')}, 18:00–00:00 Uhr`);
  });
});

describe('formatWeekdaySet', () => {
  const words = (days: number[], locale = 'en') =>
    formatWeekdaySet(days, tFor(locale), locale);

  it('says nothing for every day', () => {
    expect(words([0, 1, 2, 3, 4, 5, 6])).toBeNull();
    expect(words([])).toBeNull();
  });

  it('names the workweek as a range', () => {
    expect(words([5, 4, 3, 2, 1])).toBe('Mon–Fri');
    expect(words(WORKWEEK, 'de')).toBe('Mo–Fr');
    expect(words(WORKWEEK, 'fr')).toBe('lun.–ven.');
  });

  it('names a Monday-first run of three or more as a range', () => {
    expect(words([2, 3, 4])).toBe('Tue–Thu');
    expect(words([5, 6, 0])).toBe('Fri–Sun');
    expect(words([2, 3, 4], 'de')).toBe(`${short(2, 'de')}–${short(4, 'de')}`);
  });

  it('lists anything else, Monday first', () => {
    expect(words([5, 1, 3])).toBe('Mon, Wed, Fri');
    expect(words([0, 1])).toBe('Mon, Sun');
    expect(words([6, 0])).toBe('Sat, Sun');
  });
});

describe('occurrences', () => {
  // Tue Oct 13, 2026, 07:00 UTC — 09:00 in Zurich, 03:00 in New York.
  const AT = Date.UTC(2026, 9, 13, 7, 0);

  it('writes a start in its schedule zone', () => {
    expect(
      plain(
        formatOccurrence(
          { at: AT, timeZone: 'Europe/Zurich' },
          tFor('en'),
          'en',
        ),
      ),
    ).toBe('Tue, Oct 13, 9:00 AM');
    expect(
      plain(
        formatOccurrence(
          { at: AT, timeZone: 'Europe/Zurich' },
          tFor('de'),
          'de',
        ),
      ),
    ).toMatch(/^Di\.?, 13\. Okt\.?, 09:00$/);
  });

  it('adds the year only when it differs from the reference year', () => {
    expect(formatZonedDate(AT, 'Europe/Zurich', 'en', 2026)).toBe(
      'Tue, Oct 13',
    );
    expect(formatZonedDate(AT, 'Europe/Zurich', 'en', 2025)).toBe(
      'Tue, Oct 13, 2026',
    );
  });

  it('writes the clock in another zone and hour cycle', () => {
    expect(plain(formatZonedTime(AT, 'America/New_York', 'en'))).toBe(
      '3:00 AM',
    );
    expect(formatZonedTime(AT, 'America/New_York', 'en', 24)).toBe('03:00');
  });
});

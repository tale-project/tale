import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import { initServiceI18n } from '../../i18n/init-service';
import { uiMessages } from '../../i18n/messages';
import {
  dayBeforeMonth,
  formatCalendarDay,
  formatRecurrence,
  formatRecurrenceCompact,
  monthDayName,
  monthName,
  weekdayChipLabel,
  weekdayName,
} from './format';
import type { RecurrenceRule } from './rule';

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

const daily = (interval: number): RecurrenceRule => ({
  frequency: 'daily',
  interval,
});
const weekly = (interval: number, weekdays: number[]): RecurrenceRule => ({
  frequency: 'weekly',
  interval,
  weekdays,
});
const monthly = (interval: number, monthDay: number): RecurrenceRule => ({
  frequency: 'monthly',
  interval,
  monthDay,
});
const yearly = (
  interval: number,
  month: number,
  monthDay: number,
): RecurrenceRule => ({ frequency: 'yearly', interval, month, monthDay });

describe('names from Intl', () => {
  it('names weekdays by their getDay number', () => {
    expect(weekdayName(0, 'en')).toBe('Sunday');
    expect(weekdayName(2, 'en')).toBe('Tuesday');
    expect(weekdayName(2, 'en', 'short')).toBe('Tue');
    expect(weekdayName(2, 'de')).toBe('Dienstag');
    expect(weekdayName(2, 'fr')).toBe('mardi');
  });

  it('names months and month days, February 29 included', () => {
    expect(monthName(2, 'en')).toBe('February');
    expect(monthName(2, 'fr')).toBe('février');
    expect(monthDayName(9, 30, 'en')).toBe('Sep 30');
    expect(monthDayName(2, 29, 'en')).toBe('Feb 29');
  });

  it('knows which locales write the day first', () => {
    expect(dayBeforeMonth('en')).toBe(false);
    expect(dayBeforeMonth('de')).toBe(true);
    expect(dayBeforeMonth('fr')).toBe(true);
  });
});

describe('formatCalendarDay', () => {
  const day = { year: 2026, month: 10, day: 6 };

  it('leaves the year out when it is the reference year', () => {
    expect(formatCalendarDay(day, 'en', { referenceYear: 2026 })).toBe(
      'Tue, Oct 6',
    );
    expect(formatCalendarDay(day, 'en')).toBe('Tue, Oct 6');
  });

  it('adds the year when it differs from the reference year', () => {
    expect(
      formatCalendarDay({ year: 2027, month: 2, day: 28 }, 'en', {
        referenceYear: 2026,
      }),
    ).toBe('Sun, Feb 28, 2027');
  });
});

describe('formatRecurrence', () => {
  it.each([
    [daily(1), 'Daily'],
    [daily(3), 'Every 3 days'],
    [weekly(1, [1, 2, 3, 4, 5]), 'Every weekday'],
    [weekly(1, [2]), 'Weekly on Tuesday'],
    [weekly(2, [4, 2]), 'Every 2 weeks on Tuesday and Thursday'],
    [weekly(1, [0, 1]), 'Weekly on Monday and Sunday'],
    [
      weekly(2, [1, 2, 3, 4, 5]),
      'Every 2 weeks on Monday, Tuesday, Wednesday, Thursday, and Friday',
    ],
    [monthly(1, 30), 'Monthly on day 30'],
    [monthly(3, 1), 'Every 3 months on day 1'],
    [yearly(1, 9, 30), 'Yearly on Sep 30'],
    [yearly(2, 2, 29), 'Every 2 years on Feb 29'],
  ])('reads %j in English as %s', (rule, expected) => {
    expect(formatRecurrence(rule, tFor('en'), 'en')).toBe(expected);
  });

  it('reads every frequency in German', () => {
    const t = tFor('de');
    expect(formatRecurrence(daily(1), t, 'de')).toBe('Täglich');
    expect(formatRecurrence(daily(3), t, 'de')).toBe('Alle 3 Tage');
    expect(formatRecurrence(weekly(1, [1, 2, 3, 4, 5]), t, 'de')).toBe(
      'Jeden Werktag',
    );
    expect(formatRecurrence(weekly(1, [2]), t, 'de')).toBe(
      'Wöchentlich am Dienstag',
    );
    expect(formatRecurrence(weekly(2, [2, 4]), t, 'de')).toBe(
      'Alle 2 Wochen am Dienstag und Donnerstag',
    );
    expect(formatRecurrence(monthly(1, 30), t, 'de')).toBe('Monatlich am 30.');
    expect(formatRecurrence(monthly(2, 30), t, 'de')).toBe(
      'Alle 2 Monate am 30.',
    );
    expect(formatRecurrence(yearly(1, 9, 30), t, 'de')).toBe(
      `Jährlich am ${monthDayName(9, 30, 'de')}`,
    );
    expect(formatRecurrence(yearly(4, 9, 30), t, 'de')).toBe(
      `Alle 4 Jahre am ${monthDayName(9, 30, 'de')}`,
    );
  });

  it('reads every frequency in French, with the 1st as « 1er »', () => {
    const t = tFor('fr');
    expect(formatRecurrence(daily(1), t, 'fr')).toBe('Tous les jours');
    expect(formatRecurrence(daily(3), t, 'fr')).toBe('Tous les 3 jours');
    expect(formatRecurrence(weekly(1, [1, 2, 3, 4, 5]), t, 'fr')).toBe(
      'Tous les jours ouvrés',
    );
    expect(formatRecurrence(weekly(1, [2, 4]), t, 'fr')).toBe(
      'Chaque semaine le mardi et jeudi',
    );
    expect(formatRecurrence(weekly(2, [2]), t, 'fr')).toBe(
      'Toutes les 2 semaines le mardi',
    );
    expect(formatRecurrence(monthly(1, 1), t, 'fr')).toBe('Chaque mois le 1er');
    expect(formatRecurrence(monthly(1, 30), t, 'fr')).toBe('Chaque mois le 30');
    expect(formatRecurrence(monthly(3, 1), t, 'fr')).toBe(
      'Tous les 3 mois le 1er',
    );
    expect(formatRecurrence(yearly(1, 9, 30), t, 'fr')).toBe(
      `Chaque année le ${monthDayName(9, 30, 'fr')}`,
    );
    expect(formatRecurrence(yearly(2, 9, 30), t, 'fr')).toBe(
      `Tous les 2 ans le ${monthDayName(9, 30, 'fr')}`,
    );
  });
});

describe('formatRecurrenceCompact', () => {
  const t = () => tFor('en');

  it('has no tail for daily rules and the work week', () => {
    expect(formatRecurrenceCompact(daily(1), t(), 'en')).toEqual({
      head: 'Daily',
    });
    expect(formatRecurrenceCompact(daily(3), t(), 'en')).toEqual({
      head: 'Every 3 days',
    });
    expect(
      formatRecurrenceCompact(weekly(1, [5, 4, 3, 2, 1]), t(), 'en'),
    ).toEqual({ head: 'Weekdays' });
  });

  it('spells out one to three weekdays, Monday first', () => {
    expect(formatRecurrenceCompact(weekly(1, [2]), t(), 'en')).toEqual({
      head: 'Weekly',
      tail: 'Tue',
    });
    expect(formatRecurrenceCompact(weekly(2, [4, 2]), t(), 'en')).toEqual({
      head: 'Every 2 weeks',
      tail: 'Tue, Thu',
    });
    expect(formatRecurrenceCompact(weekly(1, [0, 6, 1]), t(), 'en')).toEqual({
      head: 'Weekly',
      tail: 'Mon, Sat, Sun',
    });
  });

  it('counts four or more weekdays', () => {
    expect(formatRecurrenceCompact(weekly(1, [1, 2, 3, 4]), t(), 'en')).toEqual(
      { head: 'Weekly', tail: '4 days' },
    );
    expect(
      formatRecurrenceCompact(weekly(2, [1, 2, 3, 4, 5]), t(), 'en'),
    ).toEqual({ head: 'Every 2 weeks', tail: '5 days' });
  });

  it('puts the anchor of monthly and yearly rules in the tail', () => {
    expect(formatRecurrenceCompact(monthly(1, 30), t(), 'en')).toEqual({
      head: 'Monthly',
      tail: 'day 30',
    });
    expect(formatRecurrenceCompact(yearly(1, 9, 30), t(), 'en')).toEqual({
      head: 'Yearly',
      tail: 'Sep 30',
    });
  });

  it('reads compact labels in German and French', () => {
    expect(
      formatRecurrenceCompact(weekly(2, [2, 4]), tFor('de'), 'de'),
    ).toEqual({
      head: 'Alle 2 Wochen',
      tail: `${weekdayName(2, 'de', 'short')}, ${weekdayName(4, 'de', 'short')}`,
    });
    expect(formatRecurrenceCompact(monthly(1, 30), tFor('de'), 'de')).toEqual({
      head: 'Monatlich',
      tail: '30.',
    });
    expect(formatRecurrenceCompact(monthly(1, 1), tFor('fr'), 'fr')).toEqual({
      head: 'Tous les mois',
      tail: 'le 1er',
    });
    expect(formatRecurrenceCompact(weekly(1, [2]), tFor('fr'), 'fr')).toEqual({
      head: 'Chaque semaine',
      tail: weekdayName(2, 'fr', 'short'),
    });
  });
});

describe('weekdayChipLabel', () => {
  it('gives two letters per weekday in each language', () => {
    const order = [1, 2, 3, 4, 5, 6, 0];
    expect(order.map((day) => weekdayChipLabel(day, tFor('en')))).toEqual([
      'Mo',
      'Tu',
      'We',
      'Th',
      'Fr',
      'Sa',
      'Su',
    ]);
    expect(order.map((day) => weekdayChipLabel(day, tFor('de')))).toEqual([
      'Mo',
      'Di',
      'Mi',
      'Do',
      'Fr',
      'Sa',
      'So',
    ]);
    expect(order.map((day) => weekdayChipLabel(day, tFor('fr')))).toEqual([
      'Lu',
      'Ma',
      'Me',
      'Je',
      'Ve',
      'Sa',
      'Di',
    ]);
  });

  it('keeps each chip label inside its long day name', () => {
    for (const locale of ['en', 'de', 'fr']) {
      for (const day of [0, 1, 2, 3, 4, 5, 6]) {
        expect(weekdayName(day, locale).toLowerCase()).toContain(
          weekdayChipLabel(day, tFor(locale)).toLowerCase(),
        );
      }
    }
  });
});

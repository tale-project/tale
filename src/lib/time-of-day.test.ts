import { describe, expect, it } from 'vitest';

import {
  clampTime,
  compareTime,
  dayPeriodLabels,
  formatHourOnly,
  formatTimeOfDay,
  localHourCycle,
  parseTimeText,
  sameTime,
  timeSegmentsOrder,
  timeSeparator,
} from './time-of-day';

/** Engines differ on the space before AM/PM: Node prints U+0020, Chromium's
 *  ICU U+202F. Compare the words, never the space. */
function plain(text: string): string {
  return text.replace(/[\s  ]+/g, ' ');
}

const NINE_THIRTY = { hour: 9, minute: 30 };
const SIX_PM = { hour: 18, minute: 0 };

describe('localHourCycle', () => {
  it.each([
    ['en', 12],
    ['en-US', 12],
    ['en-GB', 24],
    ['de', 24],
    ['de-CH', 24],
    ['fr', 24],
  ] as const)('reads %s as a %i-hour clock', (locale, cycle) => {
    expect(localHourCycle(locale)).toBe(cycle);
  });
});

describe('formatTimeOfDay', () => {
  it('writes the locale clock: 12 hours in English, 24 in German and French', () => {
    expect(plain(formatTimeOfDay(NINE_THIRTY, 'en'))).toBe('9:30 AM');
    expect(plain(formatTimeOfDay(SIX_PM, 'en'))).toBe('6:00 PM');
    expect(formatTimeOfDay(NINE_THIRTY, 'de')).toBe('09:30');
    expect(formatTimeOfDay(SIX_PM, 'fr')).toBe('18:00');
  });

  it('follows an hour cycle the host asks for', () => {
    expect(formatTimeOfDay(SIX_PM, 'en', 24)).toBe('18:00');
    expect(plain(formatTimeOfDay(SIX_PM, 'de', 12))).toMatch(/^0?6:00 PM$/);
  });

  it('writes midnight and noon the way each clock reads them', () => {
    expect(plain(formatTimeOfDay({ hour: 0, minute: 0 }, 'en'))).toBe(
      '12:00 AM',
    );
    expect(plain(formatTimeOfDay({ hour: 12, minute: 5 }, 'en'))).toBe(
      '12:05 PM',
    );
    expect(formatTimeOfDay({ hour: 0, minute: 0 }, 'de')).toBe('00:00');
  });

  it('clamps a reading out of range instead of rolling into another day', () => {
    expect(formatTimeOfDay({ hour: 27, minute: 75 }, 'de')).toBe('23:59');
  });
});

describe('formatHourOnly', () => {
  it('speaks an hour the way the locale names it', () => {
    expect(plain(formatHourOnly(21, 'en'))).toBe('9 PM');
    expect(formatHourOnly(21, 'de')).toBe('21 Uhr');
    expect(formatHourOnly(21, 'fr')).toBe('21 h');
  });
});

describe('dayPeriodLabels', () => {
  it('names the two halves of the day', () => {
    expect(dayPeriodLabels('en')).toEqual({ am: 'AM', pm: 'PM' });
  });
});

describe('timeSegmentsOrder', () => {
  it('puts the hour first in English, German and French', () => {
    expect(timeSegmentsOrder('en', 12)).toEqual([
      'hour',
      'minute',
      'dayPeriod',
    ]);
    expect(timeSegmentsOrder('de', 24)).toEqual(['hour', 'minute']);
    expect(timeSegmentsOrder('fr', 12)).toEqual([
      'hour',
      'minute',
      'dayPeriod',
    ]);
  });

  it('leads with the day period where the locale does', () => {
    expect(timeSegmentsOrder('ko', 12)).toEqual([
      'dayPeriod',
      'hour',
      'minute',
    ]);
  });

  it('drops the day period on a 24-hour clock', () => {
    expect(timeSegmentsOrder('ko', 24)).toEqual(['hour', 'minute']);
  });
});

describe('timeSeparator', () => {
  it('is the colon the locales write between hour and minute', () => {
    expect(timeSeparator('en')).toBe(':');
    expect(timeSeparator('de')).toBe(':');
    expect(timeSeparator('fr')).toBe(':');
  });
});

describe('parseTimeText', () => {
  it.each([
    ['9:30', { hour: 9, minute: 30 }],
    ['09:30', { hour: 9, minute: 30 }],
    ['  17:05  ', { hour: 17, minute: 5 }],
    ['1730', { hour: 17, minute: 30 }],
    ['930', { hour: 9, minute: 30 }],
    ['9', { hour: 9, minute: 0 }],
    ['21', { hour: 21, minute: 0 }],
    ['17h30', { hour: 17, minute: 30 }],
    ['17 h 30', { hour: 17, minute: 30 }],
    ['9h', { hour: 9, minute: 0 }],
    ['17.30', { hour: 17, minute: 30 }],
    ['9:30 pm', { hour: 21, minute: 30 }],
    ['9:30PM', { hour: 21, minute: 30 }],
    ['9 p.m.', { hour: 21, minute: 0 }],
    ['12 am', { hour: 0, minute: 0 }],
    ['12:15 a.m.', { hour: 0, minute: 15 }],
    ['12 pm', { hour: 12, minute: 0 }],
    ['0:00', { hour: 0, minute: 0 }],
  ])('reads %j', (text, time) => {
    expect(parseTimeText(text)).toEqual(time);
  });

  it.each([
    '',
    'noon',
    '24:00',
    '9:60',
    '13 pm',
    '0 am',
    '9:3',
    '12345',
    '9:30:00',
    '-1',
  ])('refuses %j', (text) => {
    expect(parseTimeText(text)).toBeNull();
  });
});

describe('comparing and clamping', () => {
  it('orders times by their place in the day', () => {
    expect(
      compareTime({ hour: 9, minute: 0 }, { hour: 17, minute: 30 }),
    ).toBeLessThan(0);
    expect(
      compareTime({ hour: 17, minute: 30 }, { hour: 9, minute: 0 }),
    ).toBeGreaterThan(0);
    expect(compareTime(NINE_THIRTY, { ...NINE_THIRTY })).toBe(0);
  });

  it('calls equal readings the same', () => {
    expect(sameTime(NINE_THIRTY, { hour: 9, minute: 30 })).toBe(true);
    expect(sameTime(NINE_THIRTY, { hour: 9, minute: 31 })).toBe(false);
  });

  it('clamps into the day and drops fractions', () => {
    expect(clampTime({ hour: -1, minute: 61 })).toEqual({
      hour: 0,
      minute: 59,
    });
    expect(clampTime({ hour: 9.7, minute: Number.NaN })).toEqual({
      hour: 9,
      minute: 0,
    });
  });
});

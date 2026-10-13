import { describe, expect, it } from 'vitest';

import {
  isWorkweek,
  matchRecurrencePreset,
  maxMonthDay,
  normalizeRecurrence,
  RECURRENCE_PRESETS,
  recurrenceDraft,
  recurrenceFromDraft,
  recurrencePreset,
  type RecurrenceReference,
  type RecurrenceRule,
  sameRecurrence,
  withRecurrenceFrequency,
  withRecurrenceMonth,
} from './rule';

/** Tue Sep 29, 2026. */
const TUESDAY: RecurrenceReference = {
  year: 2026,
  month: 9,
  day: 29,
  weekday: 2,
};

function reference(
  month: number,
  day: number,
  weekday: number,
  year = 2026,
): RecurrenceReference {
  return { year, month, day, weekday };
}

describe('maxMonthDay', () => {
  it('counts February as 29 and the rest as the calendar has them', () => {
    expect(Array.from({ length: 12 }, (_, i) => maxMonthDay(i + 1))).toEqual([
      31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
  });
});

describe('isWorkweek', () => {
  it('is Monday to Friday exactly, in any order', () => {
    expect(isWorkweek([5, 4, 3, 2, 1])).toBe(true);
    expect(isWorkweek([1, 2, 3, 4])).toBe(false);
    expect(isWorkweek([0, 1, 2, 3, 4, 5])).toBe(false);
  });
});

describe('recurrencePreset', () => {
  it.each([0, 1, 2, 3, 4, 5, 6])(
    'reads Weekly off a reference on weekday %i',
    (weekday) => {
      expect(
        recurrencePreset('weekly', reference(10, 4 + weekday, weekday)),
      ).toEqual({
        frequency: 'weekly',
        interval: 1,
        weekdays: [weekday],
      });
    },
  );

  it.each([1, 29, 31])('reads Monthly and Yearly off day %i', (day) => {
    const ref = reference(1, day, 3);
    expect(recurrencePreset('monthly', ref)).toEqual({
      frequency: 'monthly',
      interval: 1,
      monthDay: day,
    });
    expect(recurrencePreset('yearly', ref)).toEqual({
      frequency: 'yearly',
      interval: 1,
      month: 1,
      monthDay: day,
    });
  });

  it('keeps February 29 as a yearly anchor', () => {
    expect(recurrencePreset('yearly', reference(2, 29, 2, 2028))).toEqual({
      frequency: 'yearly',
      interval: 1,
      month: 2,
      monthDay: 29,
    });
  });

  it('gives Daily and Every weekday whatever the reference', () => {
    expect(recurrencePreset('daily', TUESDAY)).toEqual({
      frequency: 'daily',
      interval: 1,
    });
    expect(recurrencePreset('weekdays', TUESDAY)).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [1, 2, 3, 4, 5],
    });
  });
});

describe('matchRecurrencePreset', () => {
  it('names every preset read off the same reference', () => {
    for (const preset of RECURRENCE_PRESETS) {
      expect(
        matchRecurrencePreset(recurrencePreset(preset, TUESDAY), TUESDAY),
      ).toBe(preset);
    }
  });

  it('answers null once the reference has moved', () => {
    const weekly = recurrencePreset('weekly', TUESDAY);
    const wednesday = reference(9, 30, 3);
    expect(matchRecurrencePreset(weekly, wednesday)).toBeNull();
    expect(
      matchRecurrencePreset(recurrencePreset('monthly', TUESDAY), wednesday),
    ).toBeNull();
  });

  it('answers null for an interval above one', () => {
    expect(
      matchRecurrencePreset({ frequency: 'daily', interval: 2 }, TUESDAY),
    ).toBeNull();
  });

  it('only looks at the presets it is given', () => {
    const daily = recurrencePreset('daily', TUESDAY);
    expect(
      matchRecurrencePreset(daily, TUESDAY, ['weekly', 'monthly']),
    ).toBeNull();
    expect(matchRecurrencePreset(daily, TUESDAY, ['daily'])).toBe('daily');
  });
});

describe('normalizeRecurrence', () => {
  it('sorts and deduplicates weekdays in getDay order', () => {
    expect(
      normalizeRecurrence({
        frequency: 'weekly',
        interval: 1,
        weekdays: [4, 0, 2, 4],
      }),
    ).toEqual({ frequency: 'weekly', interval: 1, weekdays: [0, 2, 4] });
  });

  it('drops the keys a host adds', () => {
    const hostRule = {
      frequency: 'monthly' as const,
      interval: 3,
      monthDay: 30,
      timezone: 'Europe/Zurich',
      createOn: 'dueDate',
    };
    expect(normalizeRecurrence(hostRule)).toEqual({
      frequency: 'monthly',
      interval: 3,
      monthDay: 30,
    });
  });
});

describe('sameRecurrence', () => {
  it('compares frequency, step and anchors', () => {
    const weekly: RecurrenceRule = {
      frequency: 'weekly',
      interval: 2,
      weekdays: [2, 4],
    };
    expect(sameRecurrence(weekly, { ...weekly, weekdays: [4, 2] })).toBe(true);
    expect(sameRecurrence(weekly, { ...weekly, interval: 1 })).toBe(false);
    expect(sameRecurrence(weekly, { ...weekly, weekdays: [2] })).toBe(false);
    expect(
      sameRecurrence(
        { frequency: 'yearly', interval: 1, month: 2, monthDay: 29 },
        { frequency: 'yearly', interval: 1, month: 3, monthDay: 29 },
      ),
    ).toBe(false);
  });

  it('ignores the keys a host adds', () => {
    const plain: RecurrenceRule = { frequency: 'daily', interval: 1 };
    const hostRule = { ...plain, timezone: 'Asia/Tokyo', createOn: 'dueDate' };
    expect(sameRecurrence(plain, hostRule)).toBe(true);
  });

  it('treats null and undefined as the same missing rule', () => {
    expect(sameRecurrence(null, undefined)).toBe(true);
    expect(sameRecurrence(null, { frequency: 'daily', interval: 1 })).toBe(
      false,
    );
  });
});

describe('recurrenceDraft', () => {
  it('starts weekly on the reference weekday with no rule', () => {
    expect(recurrenceDraft(null, TUESDAY)).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [2],
      monthDay: 29,
      yearMonth: 9,
      yearDay: 29,
    });
  });

  it('keeps the rule’s own anchors and reads the others off the reference', () => {
    expect(
      recurrenceDraft(
        { frequency: 'monthly', interval: 3, monthDay: 15 },
        TUESDAY,
      ),
    ).toEqual({
      frequency: 'monthly',
      interval: 3,
      weekdays: [2],
      monthDay: 15,
      yearMonth: 9,
      yearDay: 29,
    });
    expect(
      recurrenceDraft(
        { frequency: 'yearly', interval: 1, month: 2, monthDay: 29 },
        TUESDAY,
      ),
    ).toMatchObject({ frequency: 'yearly', yearMonth: 2, yearDay: 29 });
  });

  it('clamps the interval to maxInterval', () => {
    expect(
      recurrenceDraft({ frequency: 'daily', interval: 40 }, TUESDAY, 30),
    ).toMatchObject({ interval: 30 });
  });
});

describe('withRecurrenceFrequency', () => {
  it('shares the interval and keeps every anchor', () => {
    const monthly = recurrenceDraft(
      { frequency: 'monthly', interval: 2, monthDay: 15 },
      TUESDAY,
    );
    const weekly = withRecurrenceFrequency(monthly, 'weekly');
    expect(weekly).toMatchObject({
      frequency: 'weekly',
      interval: 2,
      monthDay: 15,
    });
    expect(withRecurrenceFrequency(weekly, 'monthly')).toEqual(monthly);
  });
});

describe('withRecurrenceMonth', () => {
  it('clamps the day to the new month', () => {
    const march31 = recurrenceDraft(
      { frequency: 'yearly', interval: 1, month: 3, monthDay: 31 },
      TUESDAY,
    );
    expect(withRecurrenceMonth(march31, 2)).toMatchObject({
      yearMonth: 2,
      yearDay: 29,
    });
    expect(withRecurrenceMonth(march31, 4)).toMatchObject({
      yearMonth: 4,
      yearDay: 30,
    });
  });
});

describe('recurrenceFromDraft', () => {
  it('gives the rule of the draft’s unit, normalized', () => {
    const draft = {
      ...recurrenceDraft(null, TUESDAY),
      interval: 2,
      weekdays: [4, 2, 4],
    };
    expect(recurrenceFromDraft(draft)).toEqual({
      frequency: 'weekly',
      interval: 2,
      weekdays: [2, 4],
    });
    expect(
      recurrenceFromDraft(withRecurrenceFrequency(draft, 'yearly')),
    ).toEqual({ frequency: 'yearly', interval: 2, month: 9, monthDay: 29 });
  });

  it('brings a hand-built draft back into range', () => {
    expect(
      recurrenceFromDraft({
        frequency: 'yearly',
        interval: 0,
        weekdays: [],
        monthDay: 40,
        yearMonth: 2,
        yearDay: 31,
      }),
    ).toEqual({ frequency: 'yearly', interval: 1, month: 2, monthDay: 29 });
    expect(
      recurrenceFromDraft({
        frequency: 'weekly',
        interval: 1,
        weekdays: [],
        monthDay: 1,
        yearMonth: 1,
        yearDay: 1,
      }),
    ).toEqual({ frequency: 'weekly', interval: 1, weekdays: [1] });
  });
});

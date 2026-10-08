import { describe, expect, it } from 'vitest';

import { normalizeRecurrence, type RecurrenceRule } from './rule';
import {
  firstTime,
  formatScheduleTime,
  matchSchedulePreset,
  nextFreeTime,
  normalizeSchedule,
  parseScheduleTime,
  SCHEDULE_PRESETS,
  sameSchedule,
  scheduleDays,
  scheduleDraft,
  scheduleFromDraft,
  scheduleKind,
  schedulePreset,
  type ScheduleReference,
  type ScheduleRule,
  windowStarts,
} from './schedule';

/** Tue Sep 29, 2026. */
const TUESDAY: ScheduleReference = {
  year: 2026,
  month: 9,
  day: 29,
  weekday: 2,
};

describe('times as strings', () => {
  it('reads and writes "HH:MM"', () => {
    expect(parseScheduleTime('09:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseScheduleTime('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(formatScheduleTime({ hour: 7, minute: 0 })).toBe('07:00');
  });

  it.each(['9:05', '24:00', '12:60', '', '09:05:00'])('refuses %j', (text) => {
    expect(parseScheduleTime(text)).toBeNull();
  });
});

describe('presets', () => {
  it('read their day off the reference and their time off it, else 09:00', () => {
    expect(schedulePreset('every15Minutes', TUESDAY)).toEqual({
      frequency: 'minutely',
      interval: 15,
    });
    expect(schedulePreset('hourly', TUESDAY)).toEqual({
      frequency: 'hourly',
      interval: 1,
      minute: 0,
    });
    expect(schedulePreset('daily', TUESDAY)).toEqual({
      frequency: 'daily',
      interval: 1,
      times: ['09:00'],
    });
    const at730 = { ...TUESDAY, time: '07:30' };
    expect(schedulePreset('weekdays', at730)).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [1, 2, 3, 4, 5],
      times: ['07:30'],
    });
    expect(schedulePreset('weekly', at730)).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [2],
      times: ['07:30'],
    });
    expect(schedulePreset('monthly', at730)).toEqual({
      frequency: 'monthly',
      interval: 1,
      monthDay: 29,
      times: ['07:30'],
    });
  });

  it('match a rule however it is spelled, and nothing for a custom rule', () => {
    expect(
      matchSchedulePreset(
        {
          frequency: 'weekly',
          interval: 1,
          weekdays: [5, 1, 2, 3, 4],
          times: ['09:00'],
        },
        TUESDAY,
      ),
    ).toBe('weekdays');
    expect(
      matchSchedulePreset(
        {
          frequency: 'minutely',
          interval: 15,
          window: { weekdays: [0, 1, 2, 3, 4, 5, 6] },
        },
        TUESDAY,
      ),
    ).toBe('every15Minutes');
    expect(
      matchSchedulePreset(
        { frequency: 'daily', interval: 1, times: ['09:00', '17:30'] },
        TUESDAY,
      ),
    ).toBeNull();
    expect(
      matchSchedulePreset(
        { frequency: 'hourly', interval: 1, minute: 0 },
        TUESDAY,
        ['daily'],
      ),
    ).toBeNull();
  });

  it('every one is its own match', () => {
    for (const preset of SCHEDULE_PRESETS) {
      expect(
        matchSchedulePreset(schedulePreset(preset, TUESDAY), TUESDAY),
      ).toBe(preset);
    }
  });
});

describe('normalizeSchedule', () => {
  it('sorts times and weekdays and drops repeats and foreign keys', () => {
    const hosted = {
      frequency: 'weekly' as const,
      interval: 2,
      weekdays: [4, 2, 4],
      times: ['17:30', '09:00', '17:30'],
      timezone: 'Europe/Zurich',
    };
    expect(normalizeSchedule(hosted)).toEqual({
      frequency: 'weekly',
      interval: 2,
      weekdays: [2, 4],
      times: ['09:00', '17:30'],
    });
  });

  it('drops a window that limits nothing, and hours that start where they end', () => {
    expect(
      normalizeSchedule({
        frequency: 'minutely',
        interval: 15,
        window: { weekdays: [6, 5, 4, 3, 2, 1, 0] },
      }),
    ).toEqual({ frequency: 'minutely', interval: 15 });
    expect(
      normalizeSchedule({
        frequency: 'hourly',
        interval: 2,
        minute: 15,
        window: { weekdays: [5, 1], hours: { from: '08:00', to: '08:00' } },
      }),
    ).toEqual({
      frequency: 'hourly',
      interval: 2,
      minute: 15,
      window: { weekdays: [1, 5] },
    });
    // Every day, but only some hours: the window stays.
    expect(
      normalizeSchedule({
        frequency: 'minutely',
        interval: 30,
        window: {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          hours: { from: '22:00', to: '06:00' },
        },
      }),
    ).toEqual({
      frequency: 'minutely',
      interval: 30,
      window: {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        hours: { from: '22:00', to: '06:00' },
      },
    });
  });

  it('calls rules equal by meaning', () => {
    expect(
      sameSchedule(
        { frequency: 'daily', interval: 1, times: ['17:00', '09:00'] },
        { frequency: 'daily', interval: 1, times: ['09:00', '17:00', '09:00'] },
      ),
    ).toBe(true);
    expect(
      sameSchedule(
        { frequency: 'daily', interval: 1, times: ['09:00'] },
        { frequency: 'daily', interval: 2, times: ['09:00'] },
      ),
    ).toBe(false);
    expect(sameSchedule(null, undefined)).toBe(true);
    expect(sameSchedule(null, { frequency: 'minutely', interval: 5 })).toBe(
      false,
    );
  });
});

describe('a times rule is a repeat rule with times', () => {
  it.each<[ScheduleRule & { times: string[] }, RecurrenceRule]>([
    [
      { frequency: 'daily', interval: 3, times: ['09:00'] },
      { frequency: 'daily', interval: 3 },
    ],
    [
      { frequency: 'weekly', interval: 1, weekdays: [3, 1], times: ['08:00'] },
      { frequency: 'weekly', interval: 1, weekdays: [3, 1] },
    ],
    [
      { frequency: 'monthly', interval: 2, monthDay: 31, times: ['06:00'] },
      { frequency: 'monthly', interval: 2, monthDay: 31 },
    ],
    [
      {
        frequency: 'yearly',
        interval: 1,
        month: 2,
        monthDay: 29,
        times: ['12:00'],
      },
      { frequency: 'yearly', interval: 1, month: 2, monthDay: 29 },
    ],
  ])('reads %j as the day rule without its times', (rule, days) => {
    expect(scheduleKind(rule)).toBe('times');
    if (rule.frequency === 'minutely' || rule.frequency === 'hourly') return;
    expect(normalizeRecurrence(scheduleDays(rule))).toEqual(
      normalizeRecurrence(days),
    );
  });

  it('names its earliest time first; a grid names none', () => {
    expect(
      firstTime({ frequency: 'daily', interval: 1, times: ['17:30', '07:15'] }),
    ).toBe('07:15');
    expect(firstTime({ frequency: 'minutely', interval: 5 })).toBeUndefined();
  });
});

describe('drafts', () => {
  it('start daily at the reference time with grid defaults beside it', () => {
    const draft = scheduleDraft(null, { ...TUESDAY, time: '07:30' });
    expect(draft.calendar.frequency).toBe('daily');
    expect(draft.times).toEqual([{ hour: 7, minute: 30 }]);
    expect(draft.every).toEqual({ unit: 'minutely', minutes: 15, hours: 1 });
    expect(draft.minutePast).toBe(0);
    expect(draft.windowDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(draft.windowHours).toBeNull();
    expect(draft.lastWindowHours).toEqual({
      from: { hour: 8, minute: 0 },
      to: { hour: 18, minute: 0 },
    });
  });

  it.each<ScheduleRule>([
    { frequency: 'daily', interval: 1, times: ['09:00'] },
    {
      frequency: 'weekly',
      interval: 2,
      weekdays: [1, 4],
      times: ['08:00', '17:30'],
    },
    { frequency: 'monthly', interval: 1, monthDay: 31, times: ['06:00'] },
    {
      frequency: 'yearly',
      interval: 1,
      month: 2,
      monthDay: 29,
      times: ['00:00'],
    },
  ])('round-trip the times rule %j', (rule) => {
    expect(scheduleFromDraft(scheduleDraft(rule, TUESDAY), 'times')).toEqual(
      normalizeSchedule(rule),
    );
  });

  it.each<ScheduleRule>([
    { frequency: 'minutely', interval: 15 },
    {
      frequency: 'minutely',
      interval: 30,
      window: { weekdays: [1, 2, 3, 4, 5] },
    },
    {
      frequency: 'minutely',
      interval: 30,
      window: { weekdays: [5], hours: { from: '22:00', to: '06:00' } },
    },
    { frequency: 'hourly', interval: 6, minute: 0 },
    {
      frequency: 'hourly',
      interval: 2,
      minute: 15,
      window: {
        weekdays: [1, 2, 3, 4, 5],
        hours: { from: '08:00', to: '00:00' },
      },
    },
  ])('round-trip the interval rule %j', (rule) => {
    expect(scheduleFromDraft(scheduleDraft(rule, TUESDAY), 'interval')).toEqual(
      normalizeSchedule(rule),
    );
  });

  it('keep each part, so a switch of view loses nothing', () => {
    const draft = scheduleDraft(
      { frequency: 'hourly', interval: 4, minute: 30 },
      TUESDAY,
    );
    expect(draft.every).toEqual({ unit: 'hourly', minutes: 15, hours: 4 });
    // Custom times from a grid starts daily at the reference time.
    expect(scheduleFromDraft(draft, 'times')).toEqual({
      frequency: 'daily',
      interval: 1,
      times: ['09:00'],
    });
    const minutes = {
      ...draft,
      every: { ...draft.every, unit: 'minutely' as const },
    };
    expect(scheduleFromDraft(minutes, 'interval')).toEqual({
      frequency: 'minutely',
      interval: 15,
    });
  });

  it('emit times sorted without repeats, whatever order the author typed', () => {
    const draft = scheduleDraft(
      { frequency: 'daily', interval: 1, times: ['09:00'] },
      TUESDAY,
    );
    const rule = scheduleFromDraft(
      {
        ...draft,
        times: [
          { hour: 17, minute: 30 },
          { hour: 9, minute: 0 },
          { hour: 17, minute: 30 },
        ],
      },
      'times',
    );
    expect(rule).toEqual({
      frequency: 'daily',
      interval: 1,
      times: ['09:00', '17:30'],
    });
  });

  it('drop hours that start where they end: the window then runs all day', () => {
    const draft = scheduleDraft(
      { frequency: 'minutely', interval: 10 },
      TUESDAY,
    );
    const rule = scheduleFromDraft(
      {
        ...draft,
        windowDays: [1, 2, 3, 4, 5],
        windowHours: {
          from: { hour: 8, minute: 0 },
          to: { hour: 8, minute: 0 },
        },
      },
      'interval',
    );
    expect(rule).toEqual({
      frequency: 'minutely',
      interval: 10,
      window: { weekdays: [1, 2, 3, 4, 5] },
    });
  });
});

describe('windowStarts', () => {
  it('names the first and last start of a same-day window', () => {
    expect(
      windowStarts({
        frequency: 'minutely',
        interval: 15,
        window: { weekdays: [1], hours: { from: '08:00', to: '18:00' } },
      }),
    ).toEqual({
      first: { hour: 8, minute: 0 },
      last: { hour: 17, minute: 45 },
      overnight: false,
    });
    expect(
      windowStarts({
        frequency: 'hourly',
        interval: 2,
        minute: 15,
        window: { weekdays: [1], hours: { from: '09:00', to: '17:00' } },
      }),
    ).toEqual({
      first: { hour: 10, minute: 15 },
      last: { hour: 16, minute: 15 },
      overnight: false,
    });
  });

  it('runs overnight when the last start falls on the next day', () => {
    expect(
      windowStarts({
        frequency: 'minutely',
        interval: 30,
        window: { weekdays: [5], hours: { from: '22:00', to: '06:00' } },
      }),
    ).toEqual({
      first: { hour: 22, minute: 0 },
      last: { hour: 5, minute: 30 },
      overnight: true,
    });
  });

  it('ends the same day for a window until midnight', () => {
    expect(
      windowStarts({
        frequency: 'minutely',
        interval: 30,
        window: { weekdays: [5], hours: { from: '18:00', to: '00:00' } },
      }),
    ).toEqual({
      first: { hour: 18, minute: 0 },
      last: { hour: 23, minute: 30 },
      overnight: false,
    });
  });

  it('is null when no start falls between the hours', () => {
    expect(
      windowStarts({
        frequency: 'hourly',
        interval: 6,
        minute: 0,
        window: { weekdays: [1], hours: { from: '07:00', to: '11:00' } },
      }),
    ).toBeNull();
    expect(
      windowStarts({
        frequency: 'minutely',
        interval: 30,
        window: { weekdays: [1], hours: { from: '09:10', to: '09:20' } },
      }),
    ).toBeNull();
  });

  it('reads a window without hours, or with the same start and end, as all day', () => {
    const allDay = {
      first: { hour: 0, minute: 0 },
      last: { hour: 23, minute: 0 },
      overnight: false,
    };
    expect(
      windowStarts({ frequency: 'hourly', interval: 1, minute: 0 }),
    ).toEqual(allDay);
    expect(
      windowStarts({
        frequency: 'hourly',
        interval: 1,
        minute: 0,
        window: { weekdays: [1], hours: { from: '08:00', to: '08:00' } },
      }),
    ).toEqual(allDay);
  });
});

describe('nextFreeTime', () => {
  it('adds an hour after the last row', () => {
    expect(nextFreeTime([{ hour: 9, minute: 0 }])).toEqual({
      hour: 10,
      minute: 0,
    });
    expect(
      nextFreeTime([
        { hour: 17, minute: 30 },
        { hour: 9, minute: 15 },
      ]),
    ).toEqual({ hour: 10, minute: 15 });
  });

  it('starts from midnight when the next hour leaves the day or is taken', () => {
    expect(nextFreeTime([{ hour: 23, minute: 30 }])).toEqual({
      hour: 0,
      minute: 0,
    });
    expect(
      nextFreeTime([
        { hour: 0, minute: 0 },
        { hour: 10, minute: 0 },
        { hour: 9, minute: 0 },
      ]),
    ).toEqual({ hour: 1, minute: 0 });
  });
});

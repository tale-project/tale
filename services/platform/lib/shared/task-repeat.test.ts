import { describe, expect, it } from 'vitest';

import {
  calendarDateIn,
  firstTaskRepeatOccurrence,
  nextTaskRepeatDates,
  nextTaskRepeatOccurrence,
  parseTaskRepeat,
  sameTaskRepeat,
  startOfCalendarDate,
  type TaskRepeat,
  taskDateIn,
  taskRepeatCreateOn,
  taskRepeatSchema,
  upcomingTaskRepeatDates,
} from './task-repeat';

const ZURICH = 'Europe/Zurich';

/** Midnight of an ISO day in Zurich. */
function day(iso: string, tz = ZURICH): number {
  const [year, month, date] = iso.split('-').map(Number);
  return startOfCalendarDate(
    { year: year ?? 0, month: month ?? 0, day: date ?? 0 },
    tz,
  );
}

function iso(ms: number, tz = ZURICH): string {
  const d = calendarDateIn(ms, tz);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

/** 2026-09-28 is a Monday; 10:00 in Zurich. */
const MONDAY_MORNING = Date.UTC(2026, 8, 28, 8);

const weekly = (weekdays: number[], interval = 1): TaskRepeat => ({
  frequency: 'weekly',
  interval,
  weekdays,
  timezone: ZURICH,
});

describe('nextTaskRepeatOccurrence', () => {
  it('steps a daily rule by its interval', () => {
    const rule: TaskRepeat = {
      frequency: 'daily',
      interval: 1,
      timezone: ZURICH,
    };
    expect(
      iso(nextTaskRepeatOccurrence(rule, day('2026-09-28'), MONDAY_MORNING)),
    ).toBe('2026-09-29');
  });

  it('walks a late copy forward until it is no longer in the past', () => {
    const rule: TaskRepeat = {
      frequency: 'daily',
      interval: 3,
      timezone: ZURICH,
    };
    // 20 → 23 → 26 are all behind today (28); 29 is the first ahead.
    expect(
      iso(nextTaskRepeatOccurrence(rule, day('2026-09-20'), MONDAY_MORNING)),
    ).toBe('2026-09-29');
  });

  it('brings a weekly copy closed a week late back due today', () => {
    expect(
      iso(
        nextTaskRepeatOccurrence(
          weekly([1]),
          day('2026-09-21'),
          MONDAY_MORNING,
        ),
      ),
    ).toBe('2026-09-28');
    // One day later that Monday has passed: next week's.
    expect(
      iso(
        nextTaskRepeatOccurrence(
          weekly([1]),
          day('2026-09-21'),
          MONDAY_MORNING + 86_400_000,
        ),
      ),
    ).toBe('2026-10-05');
  });

  it('anchors on the due date, not the close, when a copy closes early', () => {
    expect(
      iso(
        nextTaskRepeatOccurrence(
          weekly([1]),
          day('2026-10-05'),
          MONDAY_MORNING,
        ),
      ),
    ).toBe('2026-10-12');
  });

  it('takes the rest of the week first, then skips the interval', () => {
    const rule = weekly([2, 4], 2);
    expect(
      iso(nextTaskRepeatOccurrence(rule, day('2026-09-29'), MONDAY_MORNING)),
    ).toBe('2026-10-01');
    expect(
      iso(nextTaskRepeatOccurrence(rule, day('2026-10-01'), MONDAY_MORNING)),
    ).toBe('2026-10-13');
  });

  it('jumps a workweek rule over the weekend', () => {
    expect(
      iso(
        nextTaskRepeatOccurrence(
          weekly([1, 2, 3, 4, 5]),
          day('2026-10-02'),
          MONDAY_MORNING,
        ),
      ),
    ).toBe('2026-10-05');
  });

  it('clamps a monthly day to a short month without losing it', () => {
    const rule: TaskRepeat = {
      frequency: 'monthly',
      interval: 1,
      monthDay: 31,
      timezone: ZURICH,
    };
    const january = Date.UTC(2026, 0, 15, 8);
    expect(
      iso(nextTaskRepeatOccurrence(rule, day('2026-01-31'), january)),
    ).toBe('2026-02-28');
    expect(
      iso(nextTaskRepeatOccurrence(rule, day('2026-02-28'), january)),
    ).toBe('2026-03-31');
    expect(
      iso(nextTaskRepeatOccurrence(rule, day('2026-04-30'), january)),
    ).toBe('2026-05-31');
  });

  it('steps a monthly rule by its interval', () => {
    const rule: TaskRepeat = {
      frequency: 'monthly',
      interval: 3,
      monthDay: 15,
      timezone: ZURICH,
    };
    const january = Date.UTC(2026, 0, 1, 8);
    expect(
      iso(nextTaskRepeatOccurrence(rule, day('2026-01-15'), january)),
    ).toBe('2026-04-15');
    // A copy moved to before its day comes back in the same month.
    expect(
      iso(nextTaskRepeatOccurrence(rule, day('2026-01-10'), january)),
    ).toBe('2026-01-15');
  });

  it('keeps a yearly Feb 29 on the 28th until the next leap year', () => {
    const rule: TaskRepeat = {
      frequency: 'yearly',
      interval: 1,
      month: 2,
      monthDay: 29,
      timezone: ZURICH,
    };
    expect(
      iso(
        nextTaskRepeatOccurrence(
          rule,
          day('2028-02-29'),
          Date.UTC(2028, 0, 1, 8),
        ),
      ),
    ).toBe('2029-02-28');
    expect(
      iso(
        nextTaskRepeatOccurrence(
          rule,
          day('2031-02-28'),
          Date.UTC(2031, 0, 1, 8),
        ),
      ),
    ).toBe('2032-02-29');
  });

  it('lands on local midnight on both sides of a DST change', () => {
    const sundays = weekly([0]);
    const march = Date.UTC(2026, 2, 20, 8);
    // Zurich springs forward at 02:00 on 2026-03-29: that midnight is
    // still CET (UTC+1), the next Sunday's is CEST (UTC+2).
    const spring = nextTaskRepeatOccurrence(sundays, day('2026-03-22'), march);
    expect(spring).toBe(Date.UTC(2026, 2, 28, 23));
    expect(nextTaskRepeatOccurrence(sundays, spring, march)).toBe(
      Date.UTC(2026, 3, 4, 22),
    );

    const ny = 'America/New_York';
    const daily: TaskRepeat = { frequency: 'daily', interval: 1, timezone: ny };
    const october = Date.UTC(2026, 9, 30, 12);
    // New York falls back at 02:00 on 2026-11-01.
    const first = nextTaskRepeatOccurrence(
      daily,
      day('2026-10-31', ny),
      october,
    );
    expect(first).toBe(Date.UTC(2026, 10, 1, 4));
    expect(nextTaskRepeatOccurrence(daily, first, october)).toBe(
      Date.UTC(2026, 10, 2, 5),
    );
  });

  it('catches up across decades without spinning', () => {
    const rule: TaskRepeat = {
      frequency: 'daily',
      interval: 1,
      timezone: ZURICH,
    };
    expect(
      iso(nextTaskRepeatOccurrence(rule, day('1990-01-01'), MONDAY_MORNING)),
    ).toBe('2026-09-28');
  });
});

describe('dates picked in another zone', () => {
  const LA = 'America/Los_Angeles';

  it('reads a due date at its nearest midnight in the rule zone', () => {
    // Tuesday 00:00 in Zurich is Monday 15:00 in Los Angeles; the rule set
    // in Los Angeles still reads it as the Tuesday it names.
    const rule: TaskRepeat = { ...weekly([2]), timezone: LA };
    const next = nextTaskRepeatOccurrence(
      rule,
      day('2030-01-08'),
      Date.UTC(2030, 0, 8, 8),
    );
    expect(iso(next, LA)).toBe('2030-01-15');
  });

  it('reads a reference day the same way', () => {
    // Monday 00:00 in Zurich is Sunday afternoon in Los Angeles; the day the
    // Repeat field reads its presets off is still that Monday.
    expect(taskDateIn(day('2026-09-28'), LA)).toEqual({
      year: 2026,
      month: 9,
      day: 28,
    });
  });

  it('dates a dateless copy closed in the afternoon from tomorrow', () => {
    const afternoon = Date.UTC(2026, 8, 28, 16);
    const next = nextTaskRepeatDates(
      { frequency: 'daily', interval: 1, timezone: ZURICH },
      {},
      afternoon,
    );
    expect(iso(next.dueDate ?? 0)).toBe('2026-09-29');
  });
});

describe('firstTaskRepeatOccurrence', () => {
  it('never lands before a later start date', () => {
    const daily: TaskRepeat = {
      frequency: 'daily',
      interval: 1,
      timezone: ZURICH,
    };
    expect(
      iso(firstTaskRepeatOccurrence(daily, MONDAY_MORNING, day('2026-10-05'))),
    ).toBe('2026-10-05');
    expect(
      iso(
        firstTaskRepeatOccurrence(
          weekly([5]),
          MONDAY_MORNING,
          day('2026-10-05'),
        ),
      ),
    ).toBe('2026-10-09');
    // A start date already behind today changes nothing.
    expect(
      iso(firstTaskRepeatOccurrence(daily, MONDAY_MORNING, day('2026-09-01'))),
    ).toBe('2026-09-28');
  });

  it('is today when today is one of the days, whatever the interval', () => {
    expect(iso(firstTaskRepeatOccurrence(weekly([1], 2), MONDAY_MORNING))).toBe(
      '2026-09-28',
    );
    expect(
      iso(
        firstTaskRepeatOccurrence(
          { frequency: 'daily', interval: 5, timezone: ZURICH },
          MONDAY_MORNING,
        ),
      ),
    ).toBe('2026-09-28');
  });

  it('is the next named day otherwise', () => {
    expect(iso(firstTaskRepeatOccurrence(weekly([5]), MONDAY_MORNING))).toBe(
      '2026-10-02',
    );
    expect(
      iso(
        firstTaskRepeatOccurrence(
          {
            frequency: 'monthly',
            interval: 1,
            monthDay: 15,
            timezone: ZURICH,
          },
          MONDAY_MORNING,
        ),
      ),
    ).toBe('2026-10-15');
    expect(
      iso(
        firstTaskRepeatOccurrence(
          {
            frequency: 'yearly',
            interval: 1,
            month: 9,
            monthDay: 1,
            timezone: ZURICH,
          },
          MONDAY_MORNING,
        ),
      ),
    ).toBe('2027-09-01');
  });

  it("reads today in the rule's zone, not the runtime's", () => {
    // 23:30 UTC on Sunday is already Monday in Zurich.
    const lateSunday = Date.UTC(2026, 8, 27, 23, 30);
    expect(iso(firstTaskRepeatOccurrence(weekly([1]), lateSunday))).toBe(
      '2026-09-28',
    );
  });
});

describe('nextTaskRepeatDates', () => {
  it('keeps the start date its lead before the due date', () => {
    const next = nextTaskRepeatDates(
      weekly([1]),
      { startDate: day('2026-09-24'), dueDate: day('2026-09-28') },
      MONDAY_MORNING,
    );
    expect(iso(next.dueDate ?? 0)).toBe('2026-10-05');
    expect(iso(next.startDate ?? 0)).toBe('2026-10-01');
  });

  it('steps a lone start date, and dates a dateless copy from today', () => {
    const onlyStart = nextTaskRepeatDates(
      weekly([1]),
      { startDate: day('2026-09-28') },
      MONDAY_MORNING,
    );
    expect(onlyStart.dueDate).toBeNull();
    expect(iso(onlyStart.startDate ?? 0)).toBe('2026-10-05');

    const dateless = nextTaskRepeatDates(
      { frequency: 'daily', interval: 1, timezone: ZURICH },
      {},
      MONDAY_MORNING,
    );
    expect(dateless.startDate).toBeNull();
    expect(iso(dateless.dueDate ?? 0)).toBe('2026-09-29');
  });
});

describe('taskRepeatSchema', () => {
  it('accepts every frequency', () => {
    for (const rule of [
      { frequency: 'daily', interval: 1, timezone: 'UTC' },
      weekly([0, 6], 99),
      { frequency: 'monthly', interval: 2, monthDay: 31, timezone: 'UTC' },
      {
        frequency: 'yearly',
        interval: 1,
        month: 2,
        monthDay: 29,
        timezone: 'UTC',
      },
    ]) {
      expect(taskRepeatSchema.safeParse(rule).success).toBe(true);
    }
  });

  it('refuses what no calendar can follow', () => {
    for (const rule of [
      { frequency: 'hourly', interval: 1, timezone: 'UTC' },
      { frequency: 'daily', interval: 0, timezone: 'UTC' },
      { frequency: 'daily', interval: 100, timezone: 'UTC' },
      { frequency: 'daily', interval: 1.5, timezone: 'UTC' },
      { frequency: 'daily', interval: 1, timezone: 'Mars/Olympus_Mons' },
      { frequency: 'daily', interval: 1, timezone: 'UTC', extra: true },
      weekly([]),
      weekly([1, 1]),
      weekly([7]),
      { frequency: 'monthly', interval: 1, monthDay: 32, timezone: 'UTC' },
      {
        frequency: 'yearly',
        interval: 1,
        month: 2,
        monthDay: 30,
        timezone: 'UTC',
      },
      {
        frequency: 'yearly',
        interval: 1,
        month: 4,
        monthDay: 31,
        timezone: 'UTC',
      },
    ]) {
      expect(
        taskRepeatSchema.safeParse(rule).success,
        JSON.stringify(rule),
      ).toBe(false);
    }
  });
});

describe('parseTaskRepeat / sameTaskRepeat', () => {
  it('reads a broken stored rule as none and sorts weekdays', () => {
    expect(parseTaskRepeat(null)).toBeNull();
    expect(parseTaskRepeat({ frequency: 'weekly' })).toBeNull();
    expect(parseTaskRepeat('daily')).toBeNull();
    expect(parseTaskRepeat(weekly([5, 1]))).toEqual(weekly([1, 5]));
  });

  it('compares what a rule says, not where it was set', () => {
    expect(
      sameTaskRepeat(weekly([5, 1]), { ...weekly([1, 5]), timezone: 'UTC' }),
    ).toBe(true);
    expect(sameTaskRepeat(weekly([1]), weekly([1], 2))).toBe(false);
    expect(sameTaskRepeat(weekly([1]), weekly([2]))).toBe(false);
    expect(sameTaskRepeat(null, undefined)).toBe(true);
    expect(sameTaskRepeat(weekly([1]), null)).toBe(false);
  });
});

describe('createOn', () => {
  it('accepts close and dueDate, and reads an absent key as close', () => {
    expect(
      taskRepeatSchema.safeParse({ ...weekly([1]), createOn: 'dueDate' })
        .success,
    ).toBe(true);
    expect(
      taskRepeatSchema.safeParse({ ...weekly([1]), createOn: 'weekly' })
        .success,
    ).toBe(false);
    expect(taskRepeatCreateOn(weekly([1]))).toBe('close');
  });

  it('stores the default as no key, so an old rule and a new one match', () => {
    expect(parseTaskRepeat({ ...weekly([1]), createOn: 'close' })).toEqual(
      weekly([1]),
    );
    expect(parseTaskRepeat({ ...weekly([1]), createOn: 'dueDate' })).toEqual({
      ...weekly([1]),
      createOn: 'dueDate',
    });
  });

  it('is a change of its own', () => {
    expect(
      sameTaskRepeat(weekly([1]), { ...weekly([1]), createOn: 'dueDate' }),
    ).toBe(false);
    expect(
      sameTaskRepeat(weekly([1]), { ...weekly([1]), createOn: 'close' }),
    ).toBe(true);
  });
});

describe('upcomingTaskRepeatDates', () => {
  it('keeps the due date and lists the copies after it', () => {
    const upcoming = upcomingTaskRepeatDates(
      weekly([1]),
      { dueDate: day('2026-09-28') },
      MONDAY_MORNING,
    );
    expect(iso(upcoming.dueDate)).toBe('2026-09-28');
    expect(upcoming.next.map((ms) => iso(ms))).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ]);
  });

  it('dates a task without a due date from the first matching day', () => {
    const upcoming = upcomingTaskRepeatDates(
      {
        frequency: 'monthly',
        interval: 1,
        monthDay: 31,
        timezone: ZURICH,
      },
      {},
      MONDAY_MORNING,
      2,
    );
    expect(iso(upcoming.dueDate)).toBe('2026-09-30');
    expect(upcoming.next.map((ms) => iso(ms))).toEqual([
      '2026-10-31',
      '2026-11-30',
    ]);
  });

  it('never dates it before a later start date', () => {
    const upcoming = upcomingTaskRepeatDates(
      { frequency: 'daily', interval: 1, timezone: ZURICH },
      { startDate: day('2026-10-05') },
      MONDAY_MORNING,
      1,
    );
    expect(iso(upcoming.dueDate)).toBe('2026-10-05');
    expect(upcoming.next.map((ms) => iso(ms))).toEqual(['2026-10-06']);
  });
});

import { describe, expect, it } from 'vitest';

import { canonicalTimeZone } from '../time-zone';
import {
  isoDateSchema,
  TRIGGER_ISSUE_CODES,
  triggerIssues,
  type TriggerIssue,
  triggerSkipDetailSchema,
  triggerWriteSchema,
  timeZoneSchema,
} from './automation-trigger';
import { SCHEDULE_ISSUE_CODES } from './schedule-rule';

/** The coded problems a write of `value` is refused with; none when it
 * parses. */
function issuesOf(value: unknown): Pick<TriggerIssue, 'path' | 'code'>[] {
  const parsed = triggerWriteSchema.safeParse(value);
  if (parsed.success) return [];
  return triggerIssues(parsed.error, value).map(({ path, code }) => ({
    path,
    code,
  }));
}

const daily = { frequency: 'daily', interval: 1, times: ['09:00'] };

describe('TRIGGER_ISSUE_CODES', () => {
  it('lists the twenty codes the doors answer, the schedule rule’s among them', () => {
    expect(TRIGGER_ISSUE_CODES).toHaveLength(20);
    expect(new Set(TRIGGER_ISSUE_CODES).size).toBe(20);
    for (const code of SCHEDULE_ISSUE_CODES) {
      expect(TRIGGER_ISSUE_CODES).toContain(code);
    }
    for (const code of TRIGGER_ISSUE_CODES) {
      expect(code).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });
});

describe('triggerWriteSchema', () => {
  it.each([
    ['a cron schedule', { kind: 'schedule', cron: '0 9 * * 1' }],
    [
      'a repeat rule in a zone, with a start day and a catch-up policy',
      {
        kind: 'schedule',
        repeat: daily,
        timezone: 'Europe/Zurich',
        startDate: '2026-10-08',
        catchUp: 'skip',
        enabled: false,
      },
    ],
    [
      'a webhook that rotates its address',
      { kind: 'webhook', rotateToken: true },
    ],
    ['an event', { kind: 'event', event: 'task.created' }],
  ])('accepts %s', (_case, value) => {
    expect(issuesOf(value)).toEqual([]);
  });

  it.each([
    [
      'neither a rule nor a cron',
      { kind: 'schedule' },
      [{ path: 'repeat', code: 'schedule.cron_or_repeat' }],
    ],
    [
      'a blank cron and no rule',
      { kind: 'schedule', cron: '   ' },
      [{ path: 'repeat', code: 'schedule.cron_or_repeat' }],
    ],
    [
      'both a rule and a cron',
      { kind: 'schedule', cron: '0 9 * * *', repeat: daily, timezone: 'UTC' },
      [{ path: 'repeat', code: 'schedule.cron_or_repeat' }],
    ],
    [
      'a start day beside a cron',
      { kind: 'schedule', cron: '0 9 * * *', startDate: '2026-10-08' },
      [{ path: 'startDate', code: 'schedule.start_date' }],
    ],
    [
      'a rule without a zone',
      { kind: 'schedule', repeat: daily },
      [{ path: 'timezone', code: 'timezone.required' }],
    ],
    [
      'a blank zone',
      { kind: 'schedule', cron: '0 9 * * *', timezone: '' },
      [{ path: 'timezone', code: 'timezone.blank' }],
    ],
    [
      'a zone nobody can resolve',
      { kind: 'schedule', cron: '0 9 * * *', timezone: 'Mars/Olympus_Mons' },
      [{ path: 'timezone', code: 'timezone.unknown' }],
    ],
    [
      'a start day no calendar has',
      {
        kind: 'schedule',
        repeat: daily,
        timezone: 'UTC',
        startDate: '2026-02-29',
      },
      [{ path: 'startDate', code: 'schedule.start_date' }],
    ],
    [
      'a start day past 2999',
      {
        kind: 'schedule',
        repeat: daily,
        timezone: 'UTC',
        startDate: '3000-01-01',
      },
      [{ path: 'startDate', code: 'schedule.start_date' }],
    ],
    [
      'a rule the schedule schema refuses',
      {
        kind: 'schedule',
        repeat: { ...daily, times: ['25:00'] },
        timezone: 'UTC',
      },
      [{ path: 'repeat.times.0', code: 'schedule.time_format' }],
    ],
    [
      'a catch-up policy it does not know',
      { kind: 'schedule', cron: '0 9 * * *', catchUp: 'all' },
      [{ path: 'catchUp', code: 'invalid_value' }],
    ],
    [
      'a key of another kind, and a key of none',
      { kind: 'webhook', cron: '0 9 * * *', every: 'day' },
      [
        { path: 'cron', code: 'trigger.key_other_kind' },
        { path: 'every', code: 'unrecognized_keys' },
      ],
    ],
    [
      'a schedule key on an event',
      { kind: 'event', event: 'task.created', catchUp: 'skip' },
      [{ path: 'catchUp', code: 'trigger.key_other_kind' }],
    ],
  ])('refuses %s', (_case, value, expected) => {
    expect(issuesOf(value)).toEqual(expected);
  });

  it('names a key of another kind in a sentence a caller can act on', () => {
    const value = { kind: 'webhook', repeat: daily };
    const parsed = triggerWriteSchema.safeParse(value);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(triggerIssues(parsed.error, value)[0]?.message).toBe(
      '"repeat" belongs to schedule triggers — a webhook trigger does not take it.',
    );
  });

  it('stores the zone in one spelling', () => {
    expect(
      triggerWriteSchema.parse({
        kind: 'schedule',
        cron: '0 9 * * *',
        timezone: ' europe/zurich ',
      }),
    ).toEqual({
      kind: 'schedule',
      cron: '0 9 * * *',
      timezone: 'Europe/Zurich',
    });
  });
});

describe('timeZoneSchema', () => {
  it.each([
    ['UTC', 'UTC'],
    ['utc', 'UTC'],
    [' Europe/Zurich ', 'Europe/Zurich'],
    ['+05:30', '+05:30'],
  ])('reads %j as %j', (value, expected) => {
    expect(timeZoneSchema.parse(value)).toBe(expected);
    expect(canonicalTimeZone(value)).toBe(expected);
  });

  it.each(['', '   ', 'Nowhere/City'])('refuses %j', (value) => {
    expect(timeZoneSchema.safeParse(value).success).toBe(false);
    expect(canonicalTimeZone(value)).toBeNull();
  });
});

describe('isoDateSchema', () => {
  it.each(['2000-01-01', '2028-02-29', '2999-12-31'])('accepts %s', (value) => {
    expect(isoDateSchema.safeParse(value).success).toBe(true);
  });

  it.each(['1999-12-31', '2026-13-01', '2026-04-31', '2026-1-1', 'today'])(
    'refuses %s',
    (value) => {
      expect(isoDateSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('triggerSkipDetailSchema', () => {
  const missed = {
    count: 2,
    capped: false,
    firstAt: 1,
    lastAt: 2,
    policy: 'latest',
  };

  it.each([
    { reason: 'missed_occurrences', missed, firedLatest: true },
    { reason: 'not_deployed', occurrence: 3 },
    { reason: 'not_deployed', occurrence: 3, missed },
    {
      reason: 'start_refused',
      occurrence: 3,
      code: 'AUTOMATION_INPUT_INVALID',
      version: 4,
      message: 'Run input does not match the automation inputs schema',
      issues: [{ path: 'owner', message: 'is required' }],
    },
    {
      reason: 'start_refused',
      occurrence: 3,
      code: 'PROJECT_ARCHIVED',
      version: null,
      message: 'The project is archived.',
    },
    { reason: 'unusable_cron', message: 'unknown time zone "Mars"' },
  ])('reads a $reason detail', (detail) => {
    expect(triggerSkipDetailSchema.safeParse(detail).success).toBe(true);
  });

  it('refuses more than ten problems, a long sentence, and a pause (which has no detail)', () => {
    const refused = {
      reason: 'start_refused',
      occurrence: 3,
      code: 'AUTOMATION_INPUT_INVALID',
      version: 1,
      message: 'x',
    };
    expect(
      triggerSkipDetailSchema.safeParse({
        ...refused,
        issues: Array.from({ length: 11 }, () => ({ path: 'a', message: 'b' })),
      }).success,
    ).toBe(false);
    expect(
      triggerSkipDetailSchema.safeParse({
        ...refused,
        message: 'x'.repeat(501),
      }).success,
    ).toBe(false);
    expect(
      triggerSkipDetailSchema.safeParse({ reason: 'paused_after_failures' })
        .success,
    ).toBe(false);
  });
});

describe('staticInputSchema, through the write schema', () => {
  it('takes a JSON object of values on every kind', () => {
    for (const kind of ['schedule', 'webhook', 'event'] as const) {
      const base =
        kind === 'schedule'
          ? { kind, cron: '0 9 * * *' }
          : kind === 'event'
            ? { kind, event: 'task.created' }
            : { kind };
      expect(
        issuesOf({ ...base, input: { owner: 'tale', tags: ['a'], n: 1 } }),
      ).toEqual([]);
    }
  });

  it.each([
    ['an array', [1, 2], 'input.not_object', 'input'],
    ['text', 'owner=tale', 'input.not_object', 'input'],
    [
      'a field the trigger sets itself',
      { owner: 'tale', payload: {} },
      'input.reserved_key',
      'input',
    ],
    [
      'more than 16 KiB',
      { note: 'x'.repeat(16 * 1024) },
      'input.too_large',
      'input',
    ],
  ])('refuses %s', (_case, input, code, path) => {
    expect(issuesOf({ kind: 'webhook', input })).toEqual([{ path, code }]);
  });
});

// @vitest-environment node

/**
 * `assertTriggerValid` — the single validation door for a trigger's shape,
 * reached by BOTH the HTTP door (`routes.ts`) and the engine door
 * (`dispatch-store.ts`) through `setTrigger`. A schedule whose cron cannot
 * parse (or whose timezone is not a real IANA zone) must be REFUSED at save
 * with an actionable error, never saved green to silently never fire.
 */

import { describe, expect, it } from 'vitest';

import {
  EMITTED_EVENT_TYPES,
  RESERVED_EVENT_TYPES,
} from '../../../lib/shared/event-types.ts';
import { assertTriggerValid, AutomationError, checkTrigger } from './store.ts';

describe('assertTriggerValid [AUTO-R10]', () => {
  it('accepts a valid five-field cron', () => {
    expect(() =>
      assertTriggerValid({ kind: 'schedule', cron: '0 9 * * 1' }),
    ).not.toThrow();
  });

  it('accepts a valid cron with an IANA timezone', () => {
    expect(() =>
      assertTriggerValid({
        kind: 'schedule',
        cron: '*/5 * * * *',
        timezone: 'Europe/Zurich',
      }),
    ).not.toThrow();
  });

  it('refuses a schedule with no cron', () => {
    expect(() => assertTriggerValid({ kind: 'schedule' })).toThrowError(
      AutomationError,
    );
    try {
      assertTriggerValid({ kind: 'schedule', cron: '   ' });
      expect.unreachable('blank cron must refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationError);
      expect((error as AutomationError).code).toBe(
        'AUTOMATION_TRIGGER_INVALID',
      );
      expect((error as AutomationError).status).toBe(400);
    }
  });

  it('refuses a cron that cannot parse', () => {
    for (const cron of [
      'not a cron',
      '* * * *', // four fields
      '60 * * * *', // minute out of range
      '* * * * 8-9', // day-of-week out of range
      '*/0 * * * *', // zero step
    ]) {
      expect(
        () => assertTriggerValid({ kind: 'schedule', cron }),
        `cron ${JSON.stringify(cron)} must refuse`,
      ).toThrowError(AutomationError);
    }
  });

  /**
   * A cron whose fields are each in range can still name a date no calendar
   * has: `0 0 30 2 *` used to bind with 200 and never fire. The refusal is
   * the same 400 the range checks answer, and its sentence names the pair.
   */
  it.each([
    ['0 0 30 2 *', 'day-of-month 30 never occurs in month 2'],
    ['0 0 31 2 *', 'day-of-month 31 never occurs in month 2'],
    ['0 0 31 4 *', 'day-of-month 31 never occurs in month 4'],
    ['0 0 31 4,6,9,11 *', 'day-of-month 31 never occurs in months 4, 6, 9, 11'],
  ])('refuses %s, a day no named month has', (cron, sentence) => {
    try {
      assertTriggerValid({ kind: 'schedule', cron });
      expect.unreachable('an impossible date must refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationError);
      const refusal = error as AutomationError;
      expect(refusal.code).toBe('AUTOMATION_TRIGGER_INVALID');
      expect(refusal.status).toBe(400);
      expect(refusal.message).toBe(
        `That cron expression will never fire: ${sentence}`,
      );
    }
  });

  it.each(['0 0 31 * *', '0 0 29 2 *', '0 0 31 4,5 *', '0 0 30 2 1'])(
    'accepts %s — some named month has the day, or day-of-week fires it',
    (cron) => {
      expect(() =>
        assertTriggerValid({ kind: 'schedule', cron }),
      ).not.toThrow();
    },
  );

  it('refuses a range with an end missing instead of reading it as the floor', () => {
    // `-5` used to parse as `0-5`.
    expect(() =>
      assertTriggerValid({ kind: 'schedule', cron: '-5 * * * *' }),
    ).toThrowError('"-5" is not a range');
  });

  it('refuses an unknown timezone', () => {
    try {
      assertTriggerValid({
        kind: 'schedule',
        cron: '0 9 * * *',
        timezone: 'Mars/Olympus_Mons',
      });
      expect.unreachable('bad timezone must refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationError);
      expect((error as AutomationError).code).toBe(
        'AUTOMATION_TRIGGER_INVALID',
      );
    }
  });

  it('refuses an event trigger with no event name', () => {
    expect(() => assertTriggerValid({ kind: 'event' })).toThrowError(
      AutomationError,
    );
    expect(() =>
      assertTriggerValid({ kind: 'event', event: '  ' }),
    ).toThrowError(AutomationError);
  });

  /**
   * Each kind takes its own keys: the doors refuse a key of another kind
   * with their schemas, and this guard is what every other caller (MCP
   * `set_trigger`, the seed) converges on — a webhook trigger used to store
   * a `cron` and an `event` and read back as one that ran on all three.
   */
  it.each([
    [{ kind: 'webhook', cron: '0 9 * * *' }, 'cron', 'schedule'],
    [{ kind: 'webhook', timezone: 'UTC' }, 'timezone', 'schedule'],
    [
      { kind: 'schedule', cron: '0 9 * * *', event: 'contact.created' },
      'event',
      'event',
    ],
    [
      { kind: 'event', event: 'contact.created', rotateToken: true },
      'rotateToken',
      'webhook',
    ],
    [
      { kind: 'schedule', cron: '0 9 * * *', rotateToken: false },
      'rotateToken',
      'webhook',
    ],
    [{ kind: 'webhook', wakeOnSlotFreed: true }, 'wakeOnSlotFreed', 'schedule'],
    [
      { kind: 'event', event: 'contact.created', wakeOnSlotFreed: false },
      'wakeOnSlotFreed',
      'schedule',
    ],
  ] as const)(
    'refuses %j — the key belongs to another kind',
    (trigger, key, owner) => {
      try {
        assertTriggerValid({ ...trigger });
        expect.unreachable('a key of another kind must refuse');
      } catch (error) {
        expect(error).toBeInstanceOf(AutomationError);
        const refusal = error as AutomationError;
        expect(refusal.code).toBe('AUTOMATION_TRIGGER_INVALID');
        expect(refusal.status).toBe(400);
        expect(refusal.message).toBe(
          `"${key}" belongs to ${owner} triggers — a ${trigger.kind} trigger does not take it.`,
        );
      }
    },
  );

  it('lets every kind carry its own keys and the shared switch', () => {
    expect(() =>
      assertTriggerValid({
        kind: 'schedule',
        cron: '0 9 * * 1',
        timezone: 'UTC',
        enabled: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertTriggerValid({ kind: 'webhook', rotateToken: true, enabled: true }),
    ).not.toThrow();
    expect(() =>
      assertTriggerValid({
        kind: 'event',
        event: 'contact.created',
        enabled: false,
      }),
    ).not.toThrow();
  });

  it('does not require a cron for webhook or event triggers', () => {
    expect(() => assertTriggerValid({ kind: 'webhook' })).not.toThrow();
    expect(() =>
      assertTriggerValid({ kind: 'event', event: 'contact.created' }),
    ).not.toThrow();
  });

  /**
   * An event trigger binds only an event the platform RAISES: a typo or a
   * reserved name (declared, no producer yet) used to save green, read as
   * enabled and never fire. The refusal lists what may be bound.
   */
  it('accepts every emitted event name, trimmed', () => {
    for (const event of EMITTED_EVENT_TYPES) {
      expect(() =>
        assertTriggerValid({ kind: 'event', event: ` ${event} ` }),
      ).not.toThrow();
    }
  });

  it.each([
    ...RESERVED_EVENT_TYPES,
    'tale.eval.F.no.such.event',
    'Contact.Created',
  ])('refuses %s, naming the events the platform raises', (event) => {
    try {
      assertTriggerValid({ kind: 'event', event });
      expect.unreachable('an event nobody raises must refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationError);
      const refusal = error as AutomationError;
      expect(refusal.code).toBe('AUTOMATION_TRIGGER_INVALID');
      expect(refusal.status).toBe(400);
      expect(refusal.message).toContain(`"${event}"`);
      for (const emitted of EMITTED_EVENT_TYPES) {
        expect(refusal.message).toContain(emitted);
      }
    }
  });
});

/** The code and path of the one problem a refusal names. */
function refusalOf(trigger: unknown): { code: string; path: string }[] {
  try {
    assertTriggerValid(trigger);
  } catch (error) {
    expect(error).toBeInstanceOf(AutomationError);
    const refusal = error as AutomationError;
    expect(refusal.code).toBe('AUTOMATION_TRIGGER_INVALID');
    expect(refusal.status).toBe(400);
    const issues = (refusal.data?.issues ?? []) as {
      code: string;
      path: string;
      message: string;
    }[];
    // The sentence is the first problem's.
    expect(refusal.message).toBe(issues[0]?.message);
    return issues.map(({ code, path }) => ({ code, path }));
  }
  return expect.unreachable('the trigger must be refused');
}

const daily = { frequency: 'daily', interval: 1, times: ['09:00'] };

/**
 * A repeat rule is checked as hard as a cron expression, and each refusal
 * carries a stable code the editor words as one sentence per field.
 */
describe('assertTriggerValid — repeat rules and zones [AUTO-R10]', () => {
  it.each([
    [
      'a schedule with neither a rule nor a cron',
      { kind: 'schedule', timezone: 'UTC' },
      'schedule.cron_or_repeat',
      'repeat',
    ],
    [
      'a schedule with both',
      { kind: 'schedule', cron: '0 9 * * *', repeat: daily, timezone: 'UTC' },
      'schedule.cron_or_repeat',
      'repeat',
    ],
    [
      'a rule with no time of day',
      { kind: 'schedule', repeat: { ...daily, times: [] }, timezone: 'UTC' },
      'schedule.times_required',
      'repeat.times',
    ],
    [
      'a time that is not HH:MM',
      {
        kind: 'schedule',
        repeat: { ...daily, times: ['9:00'] },
        timezone: 'UTC',
      },
      'schedule.time_format',
      'repeat.times.0',
    ],
    [
      'more than twelve times',
      {
        kind: 'schedule',
        repeat: {
          ...daily,
          times: Array.from(
            { length: 13 },
            (_, i) => `${String(i + 8).padStart(2, '0')}:00`,
          ),
        },
        timezone: 'UTC',
      },
      'schedule.times_too_many',
      'repeat.times',
    ],
    [
      'an interval the rule does not offer',
      {
        kind: 'schedule',
        repeat: { frequency: 'minutely', interval: 7 },
        timezone: 'UTC',
      },
      'schedule.interval_unsupported',
      'repeat.interval',
    ],
    [
      'a day the named month never has',
      {
        kind: 'schedule',
        repeat: {
          frequency: 'yearly',
          interval: 1,
          month: 2,
          monthDay: 30,
          times: ['09:00'],
        },
        timezone: 'UTC',
      },
      'schedule.month_day_impossible',
      'repeat.monthDay',
    ],
    [
      'a window whose start is its end',
      {
        kind: 'schedule',
        repeat: {
          frequency: 'minutely',
          interval: 15,
          window: { weekdays: [1], hours: { from: '08:00', to: '08:00' } },
        },
        timezone: 'UTC',
      },
      'schedule.window_hours_equal',
      'repeat.window.hours',
    ],
    [
      'a window no start falls in',
      {
        kind: 'schedule',
        repeat: {
          frequency: 'hourly',
          interval: 1,
          minute: 30,
          window: { weekdays: [1], hours: { from: '08:00', to: '08:15' } },
        },
        timezone: 'UTC',
      },
      'schedule.window_never_fires',
      'repeat.window.hours',
    ],
    [
      'a start date that is not a calendar day',
      {
        kind: 'schedule',
        repeat: daily,
        timezone: 'UTC',
        startDate: '2026-02-30',
      },
      'schedule.start_date',
      'startDate',
    ],
    [
      'a rule without a time zone',
      { kind: 'schedule', repeat: daily },
      'timezone.required',
      'timezone',
    ],
    [
      'a blank time zone, which used to save and never fire',
      { kind: 'schedule', cron: '0 9 * * *', timezone: '  ' },
      'timezone.blank',
      'timezone',
    ],
    [
      'a zone that does not exist',
      { kind: 'schedule', repeat: daily, timezone: 'Mars/Olympus_Mons' },
      'timezone.unknown',
      'timezone',
    ],
    [
      'a cron that cannot be read',
      { kind: 'schedule', cron: '61 * * * *' },
      'schedule.cron_unreadable',
      'cron',
    ],
    [
      'a cron that names a date no calendar has',
      { kind: 'schedule', cron: '0 0 30 2 *' },
      'schedule.cron_impossible_date',
      'cron',
    ],
    [
      'a repeat rule on a webhook',
      { kind: 'webhook', repeat: daily },
      'trigger.key_other_kind',
      'repeat',
    ],
    [
      'an event trigger without an event',
      { kind: 'event' },
      'event.required',
      'event',
    ],
    [
      'an event the platform never raises',
      { kind: 'event', event: 'no.such.event' },
      'event.unknown',
      'event',
    ],
  ])('refuses %s', (_case, trigger, code, path) => {
    expect(refusalOf(trigger)).toEqual([{ code, path }]);
  });

  it.each([
    ['a daily rule', { kind: 'schedule', repeat: daily, timezone: 'UTC' }],
    [
      'an overnight window',
      {
        kind: 'schedule',
        repeat: {
          frequency: 'minutely',
          interval: 30,
          window: { weekdays: [5], hours: { from: '22:00', to: '06:00' } },
        },
        timezone: 'Europe/Zurich',
        catchUp: 'skip',
      },
    ],
    [
      'a start date and a fixed offset zone',
      {
        kind: 'schedule',
        repeat: { ...daily, interval: 2 },
        timezone: '+05:30',
        startDate: '2026-10-08',
      },
    ],
  ])('accepts %s', (_case, trigger) => {
    expect(() => assertTriggerValid(trigger)).not.toThrow();
  });

  it('stores the zone in one spelling and anchors a rule on the day of the save in it', () => {
    // 23:30 UTC on 8 October is already the 9th in Zurich.
    const checked = checkTrigger(
      {
        kind: 'schedule',
        repeat: {
          frequency: 'weekly',
          interval: 1,
          weekdays: [3, 1],
          times: ['17:00', '08:00', '08:00'],
        },
        timezone: 'europe/zurich',
      },
      Date.UTC(2026, 9, 8, 23, 30),
    );
    expect(checked).toMatchObject({
      kind: 'schedule',
      enabled: true,
      cron: null,
      timezone: 'Europe/Zurich',
      catchUp: null,
      scheduleRule: {
        repeat: {
          frequency: 'weekly',
          interval: 1,
          weekdays: [1, 3],
          times: ['08:00', '17:00'],
        },
        startDate: '2026-10-09',
      },
    });
  });
});

import type { TriggerView } from '@tale/shared/schemas/automation-trigger';
import type { ScheduleRule } from '@tale/shared/schemas/schedule-rule';
import { describe, expect, it } from 'vitest';

import {
  occurrencesAfter,
  scheduleOfTrigger,
} from '@/lib/automations/schedule/occurrences';

import {
  DEFAULT_SCHEDULE_RULE,
  defaultTriggerDraft,
  draftFromStored,
  fixedInputIssue,
  parseFixedInput,
  repeatStartDate,
  reservedInputKeys,
  sameAsStored,
  toTriggerBody,
  type TriggerDraft,
  triggerDraftIssue,
} from './trigger-draft';

/** Tuesday, October 13, 2026, 12:00 UTC. */
const NOW = Date.UTC(2026, 9, 13, 12, 0);

function row(overrides: Partial<TriggerView>): TriggerView {
  return {
    id: 'trigger-1',
    name: 'weekly-report',
    kind: 'schedule',
    cron: null,
    repeat: null,
    startDate: null,
    timezone: null,
    catchUp: null,
    input: null,
    event: null,
    hasToken: false,
    enabled: true,
    nextRunAt: null,
    lastFiredAt: null,
    lastRunId: null,
    lastSkippedAt: null,
    lastSkipReason: null,
    lastSkipDetail: null,
    consecutiveFailures: 0,
    lastFailedAt: null,
    lastFailureCode: null,
    lastFailedRunId: null,
    ...overrides,
  };
}

const WEEKDAYS: ScheduleRule = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [1, 2, 3, 4, 5],
  times: ['09:00', '17:30'],
};

const RULE_ROW = row({
  repeat: { frequency: 'weekly', interval: 2, weekdays: [1], times: ['09:00'] },
  startDate: '2026-09-28',
  timezone: 'Europe/Zurich',
  catchUp: 'skip',
});

describe('defaultTriggerDraft', () => {
  it('is a daily 09:00 schedule in the reader’s zone, off', () => {
    expect(defaultTriggerDraft('Europe/Zurich')).toEqual({
      kind: 'schedule',
      scheduleFormat: 'repeat',
      repeat: { frequency: 'daily', interval: 1, times: ['09:00'] },
      cron: '',
      timezone: 'Europe/Zurich',
      startDate: null,
      catchUp: 'latest',
      event: '',
      input: '',
      enabled: false,
    });
  });
});

describe('draftFromStored', () => {
  it('opens a stored rule in Repeat with its anchor, zone and catch-up', () => {
    expect(draftFromStored(RULE_ROW, 'UTC')).toMatchObject({
      scheduleFormat: 'repeat',
      repeat: RULE_ROW.repeat,
      startDate: '2026-09-28',
      timezone: 'Europe/Zurich',
      catchUp: 'skip',
    });
  });

  it('opens a cron a repeat rule says exactly in Repeat, keeping the cron', () => {
    const draft = draftFromStored(
      row({ cron: '0 9 * * 1-5', timezone: 'UTC' }),
      'Europe/Zurich',
    );
    expect(draft.scheduleFormat).toBe('repeat');
    expect(draft.repeat).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [1, 2, 3, 4, 5],
      times: ['09:00'],
    });
    expect(draft.cron).toBe('0 9 * * 1-5');
  });

  it('opens any other cron in Cron, with the default rule behind Repeat', () => {
    const draft = draftFromStored(row({ cron: '0 9 31 * *' }), 'UTC');
    expect(draft.scheduleFormat).toBe('cron');
    expect(draft.repeat).toEqual(DEFAULT_SCHEDULE_RULE);
  });

  it('reads a cron without a zone in UTC, as the scan does', () => {
    expect(
      draftFromStored(row({ cron: '0 9 * * *' }), 'Europe/Zurich').timezone,
    ).toBe('UTC');
  });

  it('keeps the reader’s zone for a trigger of another kind', () => {
    expect(
      draftFromStored(row({ kind: 'webhook', hasToken: true }), 'Asia/Tokyo')
        .timezone,
    ).toBe('Asia/Tokyo');
  });

  it('shows the fixed input as indented JSON', () => {
    expect(
      draftFromStored(row({ input: { owner: 'tale' } }), 'UTC').input,
    ).toBe('{\n  "owner": "tale"\n}');
  });
});

describe('toTriggerBody', () => {
  const zurich = defaultTriggerDraft('Europe/Zurich');

  it('sends a new rule without a start date, so the server anchors it on today', () => {
    expect(toTriggerBody({ ...zurich, repeat: WEEKDAYS }, null, NOW)).toEqual({
      kind: 'schedule',
      enabled: false,
      repeat: WEEKDAYS,
      timezone: 'Europe/Zurich',
      catchUp: 'latest',
    });
  });

  it('sends the rule normalized: times sorted, duplicates gone', () => {
    const body = toTriggerBody(
      {
        ...zurich,
        repeat: {
          frequency: 'daily',
          interval: 1,
          times: ['17:30', '09:00', '17:30'],
        },
      },
      null,
      NOW,
    );
    expect(body).toMatchObject({
      repeat: { frequency: 'daily', interval: 1, times: ['09:00', '17:30'] },
    });
  });

  it('sends Cron mode as the trimmed expression', () => {
    expect(
      toTriggerBody(
        { ...zurich, scheduleFormat: 'cron', cron: '  0 9 * * 1 ' },
        null,
        NOW,
      ),
    ).toEqual({
      kind: 'schedule',
      enabled: false,
      cron: '0 9 * * 1',
      timezone: 'Europe/Zurich',
      catchUp: 'latest',
    });
  });

  // M17: a stored cron opened in Repeat goes back as the same cron until
  // the schedule itself changes.
  it('keeps a stored cron while the rule still says exactly it', () => {
    const stored = row({ cron: '0 */6 * * *', timezone: 'UTC' });
    const draft = { ...draftFromStored(stored, 'UTC'), enabled: false };
    expect(toTriggerBody(draft, stored, NOW)).toEqual({
      kind: 'schedule',
      enabled: false,
      cron: '0 */6 * * *',
      timezone: 'UTC',
      catchUp: 'latest',
    });
  });

  // M18: the start date goes back unless the frequency or interval changed.
  it('keeps the stored start date across a time-only edit', () => {
    const draft = draftFromStored(RULE_ROW, 'UTC');
    const body = toTriggerBody(
      {
        ...draft,
        repeat: { ...WEEKDAYS, interval: 2, weekdays: [1], times: ['10:00'] },
      },
      RULE_ROW,
      NOW,
    );
    expect(body).toMatchObject({ startDate: '2026-09-28' });
  });

  it('leaves the start date out once the interval changes', () => {
    const draft = draftFromStored(RULE_ROW, 'UTC');
    const body = toTriggerBody(
      {
        ...draft,
        repeat: {
          frequency: 'weekly',
          interval: 3,
          weekdays: [1],
          times: ['09:00'],
        },
      },
      RULE_ROW,
      NOW,
    );
    expect(body).not.toHaveProperty('startDate');
  });

  // M18 amended: a converted monthly step keeps the cron's months only
  // counted from January, so a time-only edit anchors on January 1.
  describe('a stored "0 9 5 */3 *" edited in Repeat', () => {
    const stored = row({ cron: '0 9 5 */3 *', timezone: 'Europe/Zurich' });
    const draft = draftFromStored(stored, 'UTC');

    it('sends January 1 with a time-only edit, and starts when the cron would', () => {
      const monthly = draft.repeat;
      if (monthly.frequency !== 'monthly') throw new Error('a monthly rule');
      expect(monthly).toMatchObject({ interval: 3, monthDay: 5 });
      const edited: TriggerDraft = {
        ...draft,
        repeat: { ...monthly, times: ['10:00'] },
      };
      const body = toTriggerBody(edited, stored, NOW);
      expect(body).toMatchObject({ startDate: '2026-01-01' });
      expect(body).not.toHaveProperty('cron');
      expect(repeatStartDate(edited, stored, NOW)).toBe('2026-01-01');

      const ruled = scheduleOfTrigger({
        cron: null,
        timezone: 'Europe/Zurich',
        scheduleRule: {
          repeat: body.kind === 'schedule' ? body.repeat : null,
          startDate: '2026-01-01',
        },
      });
      const cron = scheduleOfTrigger({
        cron: '0 10 5 */3 *',
        timezone: 'Europe/Zurich',
        scheduleRule: null,
      });
      if (!('schedule' in ruled) || !('schedule' in cron)) {
        throw new Error('both schedules read');
      }
      expect(occurrencesAfter(ruled.schedule, NOW, 8)).toEqual(
        occurrencesAfter(cron.schedule, NOW, 8),
      );
    });

    it('leaves the start date out once its interval changes', () => {
      const monthly = draft.repeat;
      if (monthly.frequency !== 'monthly') throw new Error('a monthly rule');
      const body = toTriggerBody(
        { ...draft, repeat: { ...monthly, interval: 2 } },
        stored,
        NOW,
      );
      expect(body).not.toHaveProperty('startDate');
    });
  });

  it('sends a webhook and an event with only their own fields', () => {
    expect(
      toTriggerBody({ ...zurich, kind: 'webhook', enabled: true }, null, NOW),
    ).toEqual({ kind: 'webhook', enabled: true });
    expect(
      toTriggerBody(
        { ...zurich, kind: 'event', event: ' task.created ' },
        null,
        NOW,
      ),
    ).toEqual({ kind: 'event', enabled: false, event: 'task.created' });
  });

  it('sends the fixed input as an object, and none for blank text', () => {
    expect(
      toTriggerBody(
        { ...zurich, kind: 'webhook', input: '{"owner": "tale"}' },
        null,
        NOW,
      ),
    ).toEqual({ kind: 'webhook', enabled: false, input: { owner: 'tale' } });
    expect(
      toTriggerBody({ ...zurich, kind: 'webhook', input: '  ' }, null, NOW),
    ).toEqual({ kind: 'webhook', enabled: false });
  });
});

describe('sameAsStored', () => {
  it('reads a stored trigger opened as it is as unchanged', () => {
    for (const stored of [
      RULE_ROW,
      row({ cron: '0 */6 * * *', timezone: 'UTC' }),
      row({ cron: '0 9 31 * *', timezone: 'UTC' }),
      row({ kind: 'webhook', hasToken: true, input: { a: 1 } }),
      row({ kind: 'event', event: 'task.created' }),
    ]) {
      expect(sameAsStored(draftFromStored(stored, 'UTC'), stored, NOW)).toBe(
        true,
      );
    }
  });

  it('reads flipping a convertible cron to Cron and back as unchanged', () => {
    const stored = row({ cron: '0 */6 * * *', timezone: 'UTC' });
    const draft = draftFromStored(stored, 'UTC');
    expect(
      sameAsStored({ ...draft, scheduleFormat: 'cron' }, stored, NOW),
    ).toBe(true);
  });

  it('reads an edit, a respaced but equal input, and unreadable input as such', () => {
    const stored = row({ kind: 'webhook', input: { a: 1 } });
    const draft = draftFromStored(stored, 'UTC');
    expect(sameAsStored({ ...draft, enabled: false }, stored, NOW)).toBe(false);
    expect(sameAsStored({ ...draft, input: '{"a":1}' }, stored, NOW)).toBe(
      true,
    );
    expect(sameAsStored({ ...draft, input: '{"a":' }, stored, NOW)).toBe(false);
  });

  it('reads anything drafted without a stored trigger as new', () => {
    expect(sameAsStored(defaultTriggerDraft('UTC'), null, NOW)).toBe(false);
  });
});

describe('triggerDraftIssue', () => {
  const draft = defaultTriggerDraft('Europe/Zurich');

  it('lets a complete draft save', () => {
    expect(triggerDraftIssue(draft)).toBeNull();
    expect(
      triggerDraftIssue({ ...draft, kind: 'event', event: 'task.created' }),
    ).toBeNull();
    expect(triggerDraftIssue({ ...draft, kind: 'webhook' })).toBeNull();
  });

  it.each<[string, Partial<TriggerDraft>, string]>([
    [
      'an empty cron',
      { scheduleFormat: 'cron', cron: ' ' },
      'schedule.cron_or_repeat',
    ],
    [
      'a cron the parser refuses',
      { scheduleFormat: 'cron', cron: '61 * * * *' },
      'cron_invalid',
    ],
    ['a blank zone', { timezone: '  ' }, 'timezone.blank'],
    ['an unknown zone', { timezone: 'Mars/Olympus' }, 'timezone.unknown'],
    [
      'a window no start falls in',
      {
        repeat: {
          frequency: 'hourly',
          interval: 6,
          minute: 0,
          window: { weekdays: [1], hours: { from: '01:00', to: '05:00' } },
        },
      },
      'schedule.window_never_fires',
    ],
    [
      'no times',
      { repeat: { frequency: 'daily', interval: 1, times: [] } },
      'schedule.times_required',
    ],
    [
      'an event trigger without its event',
      { kind: 'event', event: '' },
      'event.required',
    ],
    ['fixed input that is not JSON', { input: '{owner:' }, 'input_not_json'],
  ])('refuses %s', (_case, patch, issue) => {
    expect(triggerDraftIssue({ ...draft, ...patch })).toBe(issue);
  });
});

describe('fixedInputIssue', () => {
  it.each([
    ['', null],
    ['{"owner": "tale"}', null],
    ['[1, 2]', 'input.not_object'],
    ['"text"', 'input.not_object'],
    ['{"trigger": "manual"}', 'input.reserved_key'],
    [`{"blob": "${'x'.repeat(17 * 1024)}"}`, 'input.too_large'],
    ['{nope', 'input_not_json'],
  ])('reads %j as %s', (text, issue) => {
    expect(fixedInputIssue(text)).toBe(issue);
  });

  it('names the reserved keys a fixed input sets', () => {
    expect(reservedInputKeys('{"event": 1, "payload": 2, "owner": 3}')).toEqual(
      ['event', 'payload'],
    );
    expect(reservedInputKeys('nope')).toEqual([]);
  });

  it('reads blank text as no input and other text as no object', () => {
    expect(parseFixedInput(' ')).toBeUndefined();
    expect(parseFixedInput('[]')).toBeNull();
    expect(parseFixedInput('{"a": [1]}')).toEqual({ a: [1] });
  });
});

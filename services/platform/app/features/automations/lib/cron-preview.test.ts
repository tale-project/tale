import { describe, expect, it } from 'vitest';

import { cronMatches, parseCron } from '@/backend/core/automations/cron';

import {
  isValidTimezone,
  listTimezoneOptions,
  previewCronExpression,
} from './cron-preview';

describe('previewCronExpression', () => {
  it('returns empty for a blank expression', () => {
    expect(previewCronExpression('', 'UTC')).toEqual({ kind: 'empty' });
  });

  it('flags invalid expressions', () => {
    expect(previewCronExpression('not a cron', 'UTC').kind).toBe('invalid');
  });

  // The preview judges with the bind's own parser: a four-field expression
  // used to preview a "next run" and then fail to save (2026-09-26
  // evaluation, D-05). Six fields, names and `?` are refused the same way.
  it.each([
    ['*/1 * * *', 'got 4'],
    ['0 0 * * * *', 'got 6'],
    ['0 9 * * MON', 'out of range'],
    ['0 9 ? * 1', 'out of range'],
    ['61 * * * *', '"61" is out of range (0..59)'],
  ])('refuses %s with the validator’s own sentence', (cron, reason) => {
    const preview = previewCronExpression(cron, 'UTC');
    expect(preview.kind).toBe('invalid');
    if (preview.kind === 'invalid') {
      expect(preview.reason).toContain(reason);
    }
  });

  it.each(['0 0 30 2 *', '0 0 31 4 *', '0 0 31 4,6,9,11 *'])(
    'flags %s — a day no month it names has — like the bind refuses it',
    (cron) => {
      // The parser alone accepted `0 0 31 4,6 *` and previewed a date
      // decades ahead; the preview now refuses exactly what the save does.
      expect(previewCronExpression(cron, 'UTC').kind).toBe('invalid');
    },
  );

  it.each(['0 0 31 * *', '0 0 29 2 *', '0 0 31 4,5 *'])(
    'keeps %s — a day some named month has',
    (cron) => {
      expect(
        previewCronExpression(cron, 'UTC', new Date('2026-09-02T14:41:00Z'))
          .kind,
      ).toBe('ok');
    },
  );

  it('summarizes every-N-minutes and returns the next fire', () => {
    const preview = previewCronExpression(
      '*/5 * * * *',
      'UTC',
      new Date('2026-09-02T14:41:00.000Z'),
    );
    expect(preview).toEqual({
      kind: 'ok',
      nextAt: new Date('2026-09-02T14:45:00.000Z'),
      pattern: { type: 'everyMinutes', n: 5 },
    });
  });

  it('summarizes every-N-hours', () => {
    const preview = previewCronExpression(
      '0 */6 * * *',
      'UTC',
      new Date('2026-09-02T14:00:00.000Z'),
    );
    expect(preview.kind).toBe('ok');
    if (preview.kind === 'ok') {
      expect(preview.pattern).toEqual({ type: 'everyHours', n: 6 });
    }
  });
});

describe('isValidTimezone', () => {
  it.each(['UTC', 'Europe/Zurich', 'America/New_York'])(
    'accepts %s',
    (zone) => {
      expect(isValidTimezone(zone)).toBe(true);
    },
  );

  it.each(['', '   ', 'Mars/Olympus', 'Europe/Nowhere'])(
    'refuses %j like the bind does',
    (zone) => {
      expect(isValidTimezone(zone)).toBe(false);
    },
  );
});

describe('listTimezoneOptions', () => {
  it('puts UTC first and includes an extra stored zone', () => {
    const zones = listTimezoneOptions('Etc/GMT+2');
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('Etc/GMT+2');
  });
});

/**
 * The next run the Trigger section shows is the occurrence the schedule
 * scan will fire (`backend/core/automations/cron.ts`), for the five
 * Europe/Zurich cadences of a team of project agents — including around the
 * October fall-back and the March spring-forward.
 */
describe('previewCronExpression — the next run agrees with the scan', () => {
  const ZONE = 'Europe/Zurich';
  const expressions = [
    '0 0,3,6,9,12,15,18,21 * * *',
    '15 0,4,8,12,16,20 * * *',
    '45 0,3,6,9,12,15,18,21 * * *',
    '30 1,5,9,13,17,21 * * *',
    '15 3,11,19 * * *',
  ];
  const instants = [
    Date.UTC(2026, 8, 29, 15, 42, 10), // an ordinary afternoon
    Date.UTC(2026, 9, 24, 23, 59, 30), // 01:59 CEST before the fall-back
    Date.UTC(2026, 9, 25, 0, 30), // 02:30 CEST, the first 02:30
    Date.UTC(2026, 9, 25, 1, 30), // 02:30 CET, the repeated one
    Date.UTC(2027, 2, 28, 0, 59), // 01:59 CET before the spring-forward
    Date.UTC(2027, 2, 28, 1, 0), // 03:00 CEST, straight after the gap
  ];
  /** The scan's next firing minute after `from`: the first minute the
   * matcher accepts, walking forward. */
  const nextScanFire = (expression: string, from: number): number => {
    const schedule = parseCron(expression);
    let at = Math.floor(from / 60_000) * 60_000 + 60_000;
    while (!cronMatches(schedule, at, ZONE)) at += 60_000;
    return at;
  };

  it.each(
    expressions.flatMap((expression) =>
      instants.map((at) => [expression, new Date(at).toISOString()] as const),
    ),
  )('%s from %s', (expression, iso) => {
    const now = new Date(iso);
    const preview = previewCronExpression(expression, ZONE, now);
    expect(preview.kind).toBe('ok');
    if (preview.kind !== 'ok') return;
    expect(preview.nextAt.getTime()).toBe(
      nextScanFire(expression, now.getTime()),
    );
  });
});

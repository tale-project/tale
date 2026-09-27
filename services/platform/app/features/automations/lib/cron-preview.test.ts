import { describe, expect, it } from 'vitest';

import { listTimezoneOptions, previewCronExpression } from './cron-preview';

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

describe('listTimezoneOptions', () => {
  it('puts UTC first and includes an extra stored zone', () => {
    const zones = listTimezoneOptions('Etc/GMT+2');
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('Etc/GMT+2');
  });
});

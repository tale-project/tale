import { describe, expect, it } from 'vitest';

import { listTimezoneOptions, previewCronExpression } from './cron-preview';

describe('previewCronExpression', () => {
  it('returns empty for a blank expression', () => {
    expect(previewCronExpression('', 'UTC')).toEqual({ kind: 'empty' });
  });

  it('flags invalid expressions', () => {
    expect(previewCronExpression('not a cron', 'UTC').kind).toBe('invalid');
  });

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

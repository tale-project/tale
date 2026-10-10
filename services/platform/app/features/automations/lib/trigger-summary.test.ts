import type { ScheduleRule } from '@tale/shared/schemas/schedule-rule';
import { formatSchedule } from '@tale/ui/recurrence-format';
import { describe, expect, it } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';

import { triggerLines, triggerRows } from './trigger-summary';

/**
 * What starts an automation, as its Start node says it: each binding with
 * the schedule in the trigger card's words (or the cron as written),
 * whether it would fire now, and always the line for a start by hand, the
 * API or MCP.
 */

const t = i18n.getFixedT('en', 'automations');
const formatDate = (at: Date) => at.toISOString();

/** A rule in words, the way the trigger card says it in `locale`. */
function scheduleTextIn(locale: string) {
  const tRecurrence = i18n.getFixedT(locale, 'recurrence');
  return (rule: ScheduleRule) => formatSchedule(rule, tRecurrence, locale, 24);
}

const scheduleText = scheduleTextIn('en');

describe('triggerLines', () => {
  it('words a stored repeat rule and the next run the platform answered', () => {
    const nextRunAt = Date.parse('2026-10-12T07:00:00Z');
    const lines = triggerLines(
      [
        {
          kind: 'schedule',
          enabled: true,
          cron: null,
          repeat: {
            frequency: 'weekly',
            interval: 2,
            weekdays: [1],
            times: ['09:00'],
          },
          timezone: 'Europe/Zurich',
          nextRunAt,
        },
      ],
      { deployed: true, t, scheduleText },
    );
    expect(lines).toEqual([
      {
        kind: 'schedule',
        text: 'Every 2 weeks on Monday at 09:00',
        code: false,
        zone: 'Europe/Zurich',
        nextAt: nextRunAt,
        state: 'on',
      },
      { kind: 'manual', only: false },
    ]);
    expect(triggerRows(lines, { t, formatDate })).toEqual([
      expect.objectContaining({
        label: 'Every 2 weeks on Monday at 09:00 · Europe/Zurich',
        note: 'Next run 2026-10-12T07:00:00.000Z',
      }),
      expect.objectContaining({ label: 'By hand, the API or MCP' }),
    ]);
  });

  it('words a cron a rule says exactly, and shows no next run it was not given', () => {
    const [line] = triggerLines(
      [{ kind: 'schedule', enabled: true, cron: '0 7 * * *', timezone: 'UTC' }],
      { deployed: true, t, scheduleText },
    );
    expect(line).toEqual({
      kind: 'schedule',
      text: 'Daily at 07:00',
      code: false,
      zone: 'UTC',
      state: 'on',
    });
  });

  it('shows a cron no rule says as written', () => {
    const [line] = triggerLines(
      [{ kind: 'schedule', enabled: true, cron: '0 9 1 * 1' }],
      { deployed: true, t, scheduleText },
    );
    expect(line).toMatchObject({ text: '0 9 1 * 1', code: true });
    const [row] = triggerRows(line === undefined ? [] : [line], {
      t,
      formatDate,
    });
    expect(row).toMatchObject({ label: '0 9 1 * 1 · UTC', code: true });
  });

  it('says why a binding would not start a run', () => {
    const lines = triggerLines(
      [
        { kind: 'webhook', enabled: false },
        {
          kind: 'schedule',
          enabled: false,
          cron: '0 7 * * *',
          lastSkipReason: 'paused_after_failures',
        },
        { kind: 'event', enabled: true, event: 'conversation.created' },
        { kind: 'event', enabled: true, event: null },
      ],
      { deployed: false, t, scheduleText },
    );
    const rows = triggerRows(lines, { t, formatDate });
    expect(rows.map((row) => [row.label, row.badge?.label, row.note])).toEqual([
      ['A request to its webhook URL', 'Off', undefined],
      ['Daily at 07:00 · UTC', 'Paused — no runs start', undefined],
      ['When conversation.created', 'Waits for a live version', undefined],
      ['By hand, the API or MCP', undefined, undefined],
    ]);
    expect(rows[1]?.badge?.tone).toBe('warning');
  });

  it('says a run starts only by hand when nothing else starts it', () => {
    const lines = triggerLines([{ kind: 'api-key', enabled: true }], {
      deployed: true,
      t,
      scheduleText,
    });
    expect(lines).toEqual([{ kind: 'manual', only: true }]);
    expect(triggerRows(lines, { t, formatDate })[0]?.label).toBe(
      'Only by hand, the API or MCP — no trigger',
    );
  });

  it('speaks the reader’s language', () => {
    const de = i18n.getFixedT('de', 'automations');
    const rows = triggerRows(
      triggerLines([{ kind: 'schedule', enabled: true, cron: '*/5 * * * *' }], {
        deployed: true,
        t: de,
        scheduleText: scheduleTextIn('de'),
      }),
      { t: de, formatDate },
    );
    expect(rows.map((row) => row.label)).toEqual([
      'Alle 5 Minuten · UTC',
      'Von Hand, über die API oder MCP',
    ]);
  });
});

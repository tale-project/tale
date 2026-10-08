import { describe, expect, it } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';

import { triggerLines, triggerRows } from './trigger-summary';

/**
 * What starts an automation, as its Start node says it: each binding with
 * the schedule in words (or the cron as written), whether it would fire
 * now, and always the line for a start by hand, the API or MCP.
 */

const t = i18n.getFixedT('en', 'automations');
const NOW = new Date('2026-10-08T05:00:00Z');
const formatDate = (at: Date) => at.toISOString();

describe('triggerLines', () => {
  it('words a daily schedule and its next run', () => {
    const lines = triggerLines(
      [{ kind: 'schedule', enabled: true, cron: '0 7 * * *', timezone: 'UTC' }],
      { deployed: true, t, now: NOW },
    );
    expect(lines).toEqual([
      {
        kind: 'schedule',
        text: 'Every day at 07:00',
        code: false,
        zone: 'UTC',
        nextAt: Date.parse('2026-10-08T07:00:00Z'),
        state: 'on',
      },
      { kind: 'manual', only: false },
    ]);
    expect(triggerRows(lines, { t, formatDate })).toEqual([
      expect.objectContaining({
        label: 'Every day at 07:00 · UTC',
        note: 'Next run 2026-10-08T07:00:00.000Z',
      }),
      expect.objectContaining({ label: 'By hand, the API or MCP' }),
    ]);
  });

  it('shows a cron it has no words for as written', () => {
    const [line] = triggerLines(
      [{ kind: 'schedule', enabled: true, cron: '15 9 * * 1-5' }],
      { deployed: true, t, now: NOW },
    );
    expect(line).toMatchObject({ text: '15 9 * * 1-5', code: true });
    const [row] = triggerRows(line === undefined ? [] : [line], {
      t,
      formatDate,
    });
    expect(row).toMatchObject({ label: '15 9 * * 1-5 · UTC', code: true });
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
      ],
      { deployed: false, t, now: NOW },
    );
    const rows = triggerRows(lines, { t, formatDate });
    expect(rows.map((row) => [row.label, row.badge?.label, row.note])).toEqual([
      ['A request to its webhook URL', 'Off', undefined],
      ['Every day at 07:00 · UTC', 'Paused — no runs start', undefined],
      ['When conversation.created', 'Waits for a live version', undefined],
      ['By hand, the API or MCP', undefined, undefined],
    ]);
    expect(rows[1]?.badge?.tone).toBe('warning');
  });

  it('says a run starts only by hand when nothing else starts it', () => {
    const lines = triggerLines([{ kind: 'api-key', enabled: true }], {
      deployed: true,
      t,
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
        now: NOW,
      }),
      { t: de, formatDate },
    );
    expect(rows.map((row) => row.label)).toEqual([
      'Alle 5 Minuten · UTC',
      'Von Hand, über die API oder MCP',
    ]);
  });
});

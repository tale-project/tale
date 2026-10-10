import type { TriggerView } from '@tale/shared/schemas/automation-trigger';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  defaultTriggerDraft,
  draftFromStored,
  type TriggerDraft,
} from '../lib/trigger-draft';
import { useSchedulePreview } from './use-schedule-preview';

/** Tuesday, October 13, 2026, 12:00 UTC (14:00 in Zurich). */
const NOW = Date.UTC(2026, 9, 13, 12, 0);

function row(overrides: Partial<TriggerView>): TriggerView {
  return {
    id: 'trigger-1',
    name: 'report',
    kind: 'schedule',
    cron: null,
    repeat: null,
    startDate: null,
    timezone: 'Europe/Zurich',
    catchUp: 'latest',
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

const iso = (at: number) => new Date(at).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useSchedulePreview', () => {
  it('starts a new rule today, in its zone', () => {
    const { result } = renderHook(() =>
      useSchedulePreview(defaultTriggerDraft('Europe/Zurich'), null, 3),
    );
    // 09:00 Zurich has passed today; summer time runs to October 25.
    expect(result.current.occurrences?.map((o) => iso(o.at))).toEqual([
      '2026-10-14T07:00:00.000Z',
      '2026-10-15T07:00:00.000Z',
      '2026-10-16T07:00:00.000Z',
    ]);
    expect(result.current.zone).toBe('Europe/Zurich');
    expect(result.current.startDate).toEqual({
      year: 2026,
      month: 10,
      day: 13,
    });
  });

  it('marks a named time the clock skips as shifted forward', () => {
    const draft: TriggerDraft = {
      ...defaultTriggerDraft('Europe/Zurich'),
      repeat: { frequency: 'daily', interval: 1, times: ['02:30'] },
    };
    vi.setSystemTime(Date.UTC(2027, 2, 27, 12, 0));
    const { result } = renderHook(() => useSchedulePreview(draft, null, 2));
    expect(result.current.occurrences?.[0]).toEqual({
      at: Date.UTC(2027, 2, 28, 1, 30),
      timeZone: 'Europe/Zurich',
      clockChange: { kind: 'shiftedForward', wallTime: '02:30' },
    });
  });

  it('previews a stored cron sent back unchanged as that cron', () => {
    const stored = row({ cron: '0 */6 * * *', timezone: 'UTC' });
    const { result } = renderHook(() =>
      useSchedulePreview(draftFromStored(stored, 'UTC'), stored, 2),
    );
    expect(result.current.occurrences?.map((o) => iso(o.at))).toEqual([
      '2026-10-13T18:00:00.000Z',
      '2026-10-14T00:00:00.000Z',
    ]);
    expect(result.current.cronAsRule).toEqual({
      frequency: 'hourly',
      interval: 6,
      minute: 0,
    });
  });

  it('gives the picker three starts of any rule it drafts', () => {
    const { result } = renderHook(() =>
      useSchedulePreview(defaultTriggerDraft('UTC'), null),
    );
    expect(
      result.current.nextOccurrences({ frequency: 'minutely', interval: 15 }),
    ).toHaveLength(3);
  });

  it('has nothing to show for an unknown zone or a cron it cannot read', () => {
    const base = defaultTriggerDraft('Mars/Olympus');
    expect(
      renderHook(() => useSchedulePreview(base, null)).result.current
        .occurrences,
    ).toBeNull();
    expect(
      renderHook(() =>
        useSchedulePreview(
          {
            ...base,
            timezone: 'UTC',
            scheduleFormat: 'cron',
            cron: '61 * * * *',
          },
          null,
        ),
      ).result.current.occurrences,
    ).toBeNull();
  });

  it('writes the rule as one cron only when one says it', () => {
    const daily = renderHook(() =>
      useSchedulePreview(defaultTriggerDraft('UTC'), null),
    );
    expect(daily.result.current.ruleAsCron).toBe('0 9 * * *');
    const overnight = renderHook(() =>
      useSchedulePreview(
        {
          ...defaultTriggerDraft('UTC'),
          repeat: {
            frequency: 'minutely',
            interval: 30,
            window: { weekdays: [5], hours: { from: '22:00', to: '06:00' } },
          },
        },
        null,
      ),
    );
    expect(overnight.result.current.ruleAsCron).toBeNull();
  });
});

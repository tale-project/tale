import { describe, expect, it } from 'vitest';

import type { UsageWindow } from '@/app/lib/api';
import {
  planSpent,
  readableWindows,
  resetsSoon,
  windowElapsedPercent,
} from '@/app/lib/usage-windows';

const NOW = Date.parse('2026-09-22T12:00:00.000Z');
const FIVE_HOURS = 5 * 60 * 60;

function window(overrides: Partial<UsageWindow> = {}): UsageWindow {
  return {
    kind: 'session',
    label: null,
    utilization: 40,
    resetsAt: '2026-09-22T14:00:00.000Z',
    windowSeconds: FIVE_HOURS,
    ...overrides,
  };
}

describe('readableWindows', () => {
  it('drops a window the vendor reported no figure for', () => {
    const kept = window();
    const dropped = window({ kind: 'weekly', utilization: null });
    expect(readableWindows([kept, dropped])).toEqual([kept]);
  });
});

describe('planSpent', () => {
  it('calls a plan spent when its session or its weekly window is', () => {
    expect(planSpent([window({ utilization: 100 })])).toBe(true);
    expect(
      planSpent([
        window({ utilization: 12 }),
        window({ kind: 'weekly', utilization: 100 }),
      ]),
    ).toBe(true);
  });

  it('leaves a plan whose only spent window caps one model alone', () => {
    expect(
      planSpent([
        window({ utilization: 30 }),
        window({ kind: 'scoped', label: 'Fable', utilization: 100 }),
      ]),
    ).toBe(false);
  });

  it('reads the figure the bar prints, so 99.6 % is not spent', () => {
    expect(planSpent([window({ utilization: 99.6 })])).toBe(false);
  });

  it('says nothing about a plan with no reading', () => {
    expect(planSpent([])).toBe(false);
    expect(planSpent([window({ utilization: null })])).toBe(false);
  });
});

describe('windowElapsedPercent', () => {
  it('measures backwards from the rollover', () => {
    // Two of the five hours are still to run, so three are spent.
    expect(windowElapsedPercent(window(), NOW)).toBeCloseTo(60);
  });

  it('reads a rollover that has already passed as a full window', () => {
    expect(
      windowElapsedPercent(
        window({ resetsAt: '2026-09-22T11:00:00.000Z' }),
        NOW,
      ),
    ).toBe(100);
  });

  it('reads a rollover a whole window away as an untouched one', () => {
    expect(
      windowElapsedPercent(
        window({ resetsAt: '2026-09-22T18:00:00.000Z' }),
        NOW,
      ),
    ).toBe(0);
  });

  it('answers null when there is nothing honest to draw', () => {
    expect(windowElapsedPercent(window({ resetsAt: null }), NOW)).toBeNull();
    expect(
      windowElapsedPercent(window({ windowSeconds: null }), NOW),
    ).toBeNull();
    expect(windowElapsedPercent(window({ windowSeconds: 0 }), NOW)).toBeNull();
    expect(
      windowElapsedPercent(window({ resetsAt: 'not a date' }), NOW),
    ).toBeNull();
  });
});

describe('resetsSoon', () => {
  it('points out a rollover inside the hour', () => {
    expect(
      resetsSoon(window({ resetsAt: '2026-09-22T12:25:00.000Z' }), NOW),
    ).toBe(true);
  });

  it('leaves one an hour or more away alone', () => {
    expect(
      resetsSoon(window({ resetsAt: '2026-09-22T13:00:00.000Z' }), NOW),
    ).toBe(false);
    expect(resetsSoon(window(), NOW)).toBe(false);
  });

  it('does not call a rollover that has passed soon', () => {
    // The reading predates it; the next read replaces the window.
    expect(
      resetsSoon(window({ resetsAt: '2026-09-22T11:59:00.000Z' }), NOW),
    ).toBe(false);
  });

  it('says nothing about a window with no rollover', () => {
    expect(resetsSoon(window({ resetsAt: null }), NOW)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import type { UsageWindow } from '@/app/lib/api';
import { readableWindows, windowElapsedPercent } from '@/app/lib/usage-windows';

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

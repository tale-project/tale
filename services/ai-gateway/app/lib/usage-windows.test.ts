import { describe, expect, it } from 'vitest';

import type { UsageWindow } from '@/app/lib/api';
import {
  hasRolledOver,
  readableWindows,
  resetRole,
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
    blocking: false,
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

describe('resetsSoon', () => {
  it('points out a rollover inside the hour', () => {
    expect(resetsSoon('2026-09-22T12:25:00.000Z', NOW)).toBe(true);
  });

  it('leaves one an hour or more away alone', () => {
    expect(resetsSoon('2026-09-22T13:00:00.000Z', NOW)).toBe(false);
    expect(resetsSoon('2026-09-22T14:00:00.000Z', NOW)).toBe(false);
  });

  it('does not call a rollover that has passed soon', () => {
    // The reading predates it; the next read replaces the window.
    expect(resetsSoon('2026-09-22T11:59:00.000Z', NOW)).toBe(false);
  });

  it('says nothing about a window with no rollover', () => {
    expect(resetsSoon(null, NOW)).toBe(false);
  });
});

describe('hasRolledOver', () => {
  it('is true from the instant of the rollover on', () => {
    expect(hasRolledOver('2026-09-22T11:59:00.000Z', NOW)).toBe(true);
    expect(hasRolledOver('2026-09-22T12:00:00.000Z', NOW)).toBe(true);
  });

  it('is false while the rollover is ahead, or when there is none to read', () => {
    expect(hasRolledOver('2026-09-22T12:00:01.000Z', NOW)).toBe(false);
    expect(hasRolledOver(null, NOW)).toBe(false);
    expect(hasRolledOver('not a date', NOW)).toBe(false);
  });
});

describe('resetRole', () => {
  const session = window({
    kind: 'session',
    utilization: 100,
    resetsAt: '2026-09-22T12:05:00.000Z',
    blocking: true,
  });
  const weekly = window({
    kind: 'weekly',
    utilization: 100,
    resetsAt: '2026-09-25T12:00:00.000Z',
    blocking: true,
  });

  it('reads the clock the account waits for as its return, and the one it only waits behind as waiting', () => {
    // Session back in five minutes, week in three days: the account is back
    // in three days, so that is the clock that counts.
    const limitedUntil = '2026-09-25T12:00:00.000Z';
    expect(resetRole(weekly, limitedUntil)).toBe('return');
    expect(resetRole(session, limitedUntil)).toBe('waiting');
  });

  it('compares instants, not spellings', () => {
    expect(
      resetRole(
        { ...weekly, resetsAt: '2026-09-25T12:00:00+00:00' },
        '2026-09-25T12:00:00.000Z',
      ),
    ).toBe('return');
  });

  it('calls every window that is not holding the account back an ordinary countdown', () => {
    expect(
      resetRole(
        window({ resetsAt: '2026-09-22T12:20:00.000Z' }),
        '2026-09-25T12:00:00.000Z',
      ),
    ).toBe('running');
    // Not even when the account itself has nothing to wait for.
    expect(resetRole(window(), null)).toBe('running');
  });

  it('takes the window with no stated rollover as the return when that is the unknown one', () => {
    const undated = window({
      utilization: 100,
      resetsAt: null,
      blocking: true,
    });
    expect(resetRole(undated, null)).toBe('return');
    // …and a dated one beside it waits behind it.
    expect(resetRole(weekly, null)).toBe('waiting');
  });
});

import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_STATES,
  deriveAccountState,
  rolledOverSince,
  type StateInput,
} from './account-state';
import type { UsageWindow } from './providers/types';

const NOW = Date.parse('2026-10-15T10:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function window(
  kind: UsageWindow['kind'],
  utilization: number | null,
  resetsInMs: number | null,
  label: string | null = null,
): UsageWindow {
  return {
    kind,
    label,
    utilization,
    resetsAt: resetsInMs === null ? null : at(resetsInMs),
    windowSeconds: kind === 'session' ? 18_000 : 604_800,
  };
}

function input(
  windows: UsageWindow[],
  extra: Partial<StateInput> & { limited?: boolean | null } = {},
): StateInput {
  const { limited, ...rest } = extra;
  return {
    status: 'active',
    usage: { windows, ...(limited === undefined ? {} : { limited }) },
    ...rest,
  };
}

describe('deriveAccountState', () => {
  it('lists the states from best to worst', () => {
    expect(ACCOUNT_STATES).toEqual([
      'available',
      'limited',
      'expired',
      'error',
    ]);
  });

  it('calls an account with no reading available', () => {
    expect(deriveAccountState({ status: 'active', usage: null }, NOW)).toEqual({
      state: 'available',
      limitedUntil: null,
      blocking: [],
    });
  });

  it('calls an account with room in every window available', () => {
    const derived = deriveAccountState(
      input([window('session', 40, 2 * HOUR), window('weekly', 99.6, 2 * DAY)]),
      NOW,
    );
    // 99.6 is not the ceiling: it reads 99 and still has something left.
    expect(derived).toMatchObject({ state: 'available', limitedUntil: null });
    expect(derived.blocking).toEqual([false, false]);
  });

  it('is back when the session rolls over, if only the session is spent', () => {
    const derived = deriveAccountState(
      input([
        window('session', 100, 5 * MINUTE),
        window('weekly', 41, 3 * DAY),
      ]),
      NOW,
    );
    expect(derived).toEqual({
      state: 'limited',
      limitedUntil: at(5 * MINUTE),
      blocking: [true, false],
    });
  });

  it('is back in three days, not in five minutes, when the weekly is spent too', () => {
    // The case the panel exists to get right: the session window comes back
    // soon, and the account does not.
    const derived = deriveAccountState(
      input([
        window('session', 100, 5 * MINUTE),
        window('weekly', 100, 3 * DAY),
      ]),
      NOW,
    );
    expect(derived).toEqual({
      state: 'limited',
      limitedUntil: at(3 * DAY),
      blocking: [true, true],
    });
  });

  it('is back in three days when only the weekly is spent', () => {
    const derived = deriveAccountState(
      input([
        window('session', 20, 5 * MINUTE),
        window('weekly', 100, 3 * DAY),
      ]),
      NOW,
    );
    expect(derived).toMatchObject({
      state: 'limited',
      limitedUntil: at(3 * DAY),
      blocking: [false, true],
    });
  });

  it('never limits an account on a per-model cap', () => {
    const derived = deriveAccountState(
      input([
        window('session', 10, 2 * HOUR),
        window('weekly', 30, 2 * DAY),
        window('scoped', 100, 2 * DAY, 'Fable'),
      ]),
      NOW,
    );
    expect(derived.state).toBe('available');
    expect(derived.blocking).toEqual([false, false, false]);
  });

  it('stops counting a spent window whose rollover is behind the clock', () => {
    const derived = deriveAccountState(
      input([window('session', 100, -MINUTE), window('weekly', 12, 2 * DAY)]),
      NOW,
    );
    expect(derived).toEqual({
      state: 'available',
      limitedUntil: null,
      blocking: [false, false],
    });
  });

  it('is limited by the window still ahead when its sibling has rolled over', () => {
    const derived = deriveAccountState(
      input([window('session', 100, -MINUTE), window('weekly', 100, 2 * DAY)]),
      NOW,
    );
    expect(derived).toMatchObject({
      state: 'limited',
      limitedUntil: at(2 * DAY),
      blocking: [false, true],
    });
  });

  it('is limited with no known return when a spent window states no rollover', () => {
    const derived = deriveAccountState(
      input([window('weekly', 100, null)]),
      NOW,
    );
    expect(derived).toEqual({
      state: 'limited',
      limitedUntil: null,
      blocking: [true],
    });
  });

  it('does not promise a return that one spent window cannot date', () => {
    // The dated window would say tomorrow; the undated one says nothing, and
    // the account is back only when both are.
    const derived = deriveAccountState(
      input([window('session', 100, null), window('weekly', 100, DAY)]),
      NOW,
    );
    expect(derived.state).toBe('limited');
    expect(derived.limitedUntil).toBeNull();
  });

  describe('the vendor’s own limit flag', () => {
    it('limits an account whose windows do not show it, with no return date', () => {
      const derived = deriveAccountState(
        input([window('weekly', 80, 2 * DAY)], { limited: true }),
        NOW,
      );
      expect(derived).toEqual({
        state: 'limited',
        limitedUntil: null,
        blocking: [false],
      });
    });

    it('yields to a full window that has since rolled over', () => {
      const derived = deriveAccountState(
        input([window('weekly', 100, -HOUR)], { limited: true }),
        NOW,
      );
      expect(derived.state).toBe('available');
    });

    it('dates the return by the full window it agrees with', () => {
      const derived = deriveAccountState(
        input([window('weekly', 100, DAY)], { limited: true }),
        NOW,
      );
      expect(derived).toMatchObject({
        state: 'limited',
        limitedUntil: at(DAY),
      });
    });

    it('is not a limit when the vendor says it is not', () => {
      expect(
        deriveAccountState(
          input([window('weekly', 30, DAY)], { limited: false }),
          NOW,
        ).state,
      ).toBe('available');
    });
  });

  it.each(['expired', 'error'] as const)(
    'puts a %s credential first, whatever the quota reads',
    (status) => {
      const derived = deriveAccountState(
        input([window('weekly', 100, 3 * DAY)], { status }),
        NOW,
      );
      expect(derived).toEqual({
        state: status,
        limitedUntil: null,
        blocking: [false],
      });
    },
  );
});

describe('rolledOverSince', () => {
  const spent = window('weekly', 100, -5 * MINUTE);

  it('is true for a rollover after the reading and before now', () => {
    expect(rolledOverSince(spent, NOW - 10 * MINUTE, NOW)).toBe(true);
  });

  it('is false for a rollover the reading already knew about', () => {
    expect(rolledOverSince(spent, NOW - MINUTE, NOW)).toBe(false);
  });

  it('is false for a rollover still ahead, or none stated', () => {
    expect(rolledOverSince(window('weekly', 10, HOUR), NOW - DAY, NOW)).toBe(
      false,
    );
    expect(rolledOverSince(window('weekly', 10, null), NOW - DAY, NOW)).toBe(
      false,
    );
  });
});

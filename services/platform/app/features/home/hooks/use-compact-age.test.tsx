import { LocaleProvider } from '@tale/ui/i18n/locale-provider';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatCompactAge,
  msUntilCompactAgeChanges,
  useCompactAge,
} from './use-compact-age';

const NOW = new Date(2026, 8, 23, 12, 0, 0).getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatCompactAge', () => {
  it('shares Intl formatters across a large list and its later clock ticks', () => {
    const { NumberFormat, RelativeTimeFormat, DateTimeFormat } = Intl;
    const number = vi.spyOn(Intl, 'NumberFormat').mockImplementation(function (
      ...args
    ) {
      return new NumberFormat(...args);
    });
    const relative = vi
      .spyOn(Intl, 'RelativeTimeFormat')
      .mockImplementation(function (...args) {
        return new RelativeTimeFormat(...args);
      });
    const date = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
      ...args
    ) {
      return new DateTimeFormat(...args);
    });
    try {
      for (let row = 0; row < 1_000; row++) {
        formatCompactAge(NOW - row * MINUTE, NOW, 'en-AU');
        formatCompactAge(NOW - row * MINUTE, NOW + MINUTE, 'en-AU');
      }
      expect(number).toHaveBeenCalledTimes(3);
      expect(relative).toHaveBeenCalledTimes(1);
      expect(date).toHaveBeenCalledTimes(2);
    } finally {
      number.mockRestore();
      relative.mockRestore();
      date.mockRestore();
    }
  });

  it('reads as a short age within the week', () => {
    expect(formatCompactAge(NOW - 20_000, NOW, 'en')).toBe('now');
    expect(formatCompactAge(NOW - 5 * MINUTE, NOW, 'en')).toBe('5m');
    expect(formatCompactAge(NOW - 3 * 60 * MINUTE, NOW, 'en')).toBe('3h');
    expect(formatCompactAge(NOW - 2 * 24 * 60 * MINUTE, NOW, 'en')).toBe('2d');
  });

  it('switches to the date after a week', () => {
    const tenDaysAgo = NOW - 10 * 24 * 60 * MINUTE;
    expect(formatCompactAge(tenDaysAgo, NOW, 'en')).toBe('Sep 13');
  });

  it('abbreviates the way each locale does', () => {
    // The narrow unit is the runtime's own locale data, and that data moves
    // between builds (German reads "3 Std." under one ICU, "3h" under
    // another) — so pin that the locale reaches Intl, not a literal.
    const narrowHours = new Intl.NumberFormat('de', {
      style: 'unit',
      unit: 'hour',
      unitDisplay: 'narrow',
    }).format(3);
    expect(formatCompactAge(NOW - 3 * 60 * MINUTE, NOW, 'de')).toBe(
      narrowHours,
    );
    // English would read "now".
    expect(formatCompactAge(NOW - 20_000, NOW, 'de')).toBe('jetzt');
  });

  it('never reads a future timestamp as negative', () => {
    expect(formatCompactAge(NOW + 5 * MINUTE, NOW, 'en')).toBe('now');
  });
});

describe('msUntilCompactAgeChanges', () => {
  it('waits for the next boundary of the unit the age is counted in', () => {
    expect(msUntilCompactAgeChanges(NOW - 20_000, NOW)).toBe(40_000);
    expect(msUntilCompactAgeChanges(NOW - 5 * MINUTE - 10_000, NOW)).toBe(
      50_000,
    );
    expect(msUntilCompactAgeChanges(NOW - 3 * HOUR - 10 * MINUTE, NOW)).toBe(
      50 * MINUTE,
    );
    expect(msUntilCompactAgeChanges(NOW - 2 * DAY - HOUR, NOW)).toBe(23 * HOUR);
  });

  it('waits for New Year once the age shows a date', () => {
    expect(msUntilCompactAgeChanges(NOW - 10 * DAY, NOW)).toBe(
      new Date(2027, 0, 1).getTime() - NOW,
    );
  });

  it('lands where the label reads differently', () => {
    for (const age of [20_000, 5 * MINUTE, 59 * MINUTE, 3 * HOUR, 6 * DAY]) {
      const timestamp = NOW - age;
      const wait = msUntilCompactAgeChanges(timestamp, NOW);
      expect(formatCompactAge(timestamp, NOW + wait - 1, 'en')).toBe(
        formatCompactAge(timestamp, NOW, 'en'),
      );
      expect(formatCompactAge(timestamp, NOW + wait, 'en')).not.toBe(
        formatCompactAge(timestamp, NOW, 'en'),
      );
    }
  });
});

describe('useCompactAge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <LocaleProvider defaultLocale="en">{children}</LocaleProvider>
  );

  // A Home list renders hundreds of rows: a row woken every minute to read
  // the same "2d" again was hundreds of renders a minute for nothing.
  it('re-renders when the label changes, not every minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    localStorage.setItem('user-locale', 'en');
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return useCompactAge(NOW - 2 * DAY - 23 * HOUR);
      },
      { wrapper },
    );
    expect(result.current).toBe('2d');
    const settled = renders;

    act(() => {
      vi.advanceTimersByTime(30 * MINUTE);
    });
    expect(renders).toBe(settled);

    act(() => {
      vi.advanceTimersByTime(31 * MINUTE);
    });
    expect(result.current).toBe('3d');
    expect(renders).toBe(settled + 1);
  });
});

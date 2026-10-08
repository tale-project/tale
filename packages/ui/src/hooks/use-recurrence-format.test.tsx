import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initServiceI18n } from '../i18n/init-service';
import { uiMessages } from '../i18n/messages';
import { useRecurrenceFormat } from './use-recurrence-format';

let i18n: ReturnType<typeof initServiceI18n>;
beforeAll(async () => {
  i18n = initServiceI18n({
    bundles: { en: {}, de: {}, fr: {} },
    regional: {},
    packages: [uiMessages],
  });
  await i18n.changeLanguage('en');
});

afterEach(async () => {
  await i18n.changeLanguage('en');
});

function wrapper({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

describe('useRecurrenceFormat', () => {
  it('formats sentences, compact labels and days in the rendered language', () => {
    const { result } = renderHook(() => useRecurrenceFormat(), { wrapper });
    const rule = {
      frequency: 'weekly' as const,
      interval: 2,
      weekdays: [2, 4],
    };
    expect(result.current.sentence(rule)).toBe(
      'Every 2 weeks on Tuesday and Thursday',
    );
    expect(result.current.compact(rule)).toEqual({
      head: 'Every 2 weeks',
      tail: 'Tue, Thu',
    });
    expect(result.current.day({ year: 2026, month: 10, day: 6 }, 2026)).toBe(
      'Tue, Oct 6',
    );
    expect(result.current.never).toBe('Never');
    expect(result.current.locale).toBe('en');
  });

  it('follows a change of language', async () => {
    const { result } = renderHook(() => useRecurrenceFormat(), { wrapper });
    await act(async () => {
      await i18n.changeLanguage('de');
    });
    expect(result.current.never).toBe('Nie');
    expect(result.current.locale).toBe('de');
    expect(
      result.current.sentence({
        frequency: 'monthly',
        interval: 1,
        monthDay: 30,
      }),
    ).toBe('Monatlich am 30.');
  });

  it('words schedules, times and starts in the rendered language', async () => {
    const { result } = renderHook(() => useRecurrenceFormat(), { wrapper });
    const plain = (text: string) => text.replace(/[\s\u202f]+/g, ' ');
    const rule = {
      frequency: 'weekly' as const,
      interval: 1,
      weekdays: [1, 2, 3, 4, 5],
      times: ['17:30', '09:00'],
    };
    expect(result.current.hourCycle).toBe(12);
    expect(plain(result.current.schedule(rule))).toBe(
      'Every weekday at 9:00 AM and 5:30 PM',
    );
    expect(result.current.schedule(rule, 24)).toBe(
      'Every weekday at 09:00 and 17:30',
    );
    const compact = result.current.scheduleCompact(rule);
    expect(compact.head).toBe('Weekdays');
    expect(plain(compact.tail ?? '')).toBe('9:00 AM, 5:30 PM');
    expect(plain(result.current.time('21:05'))).toBe('9:05 PM');
    expect(plain(result.current.time({ hour: 7, minute: 0 }))).toBe('7:00 AM');
    expect(
      plain(
        result.current.occurrence(
          { at: Date.UTC(2027, 0, 5, 8, 0), timeZone: 'Europe/Zurich' },
          2026,
        ),
      ),
    ).toBe('Tue, Jan 5, 2027, 9:00 AM');
    await act(async () => {
      await i18n.changeLanguage('de');
    });
    expect(result.current.hourCycle).toBe(24);
    expect(result.current.schedule(rule)).toBe(
      'Jeden Werktag um 09:00 und 17:30 Uhr',
    );
    expect(result.current.time('21:05')).toBe('21:05');
  });

  it('keeps its functions stable across renders', () => {
    const { result, rerender } = renderHook(() => useRecurrenceFormat(), {
      wrapper,
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

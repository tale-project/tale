import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import type { TaskRepeat } from '@/lib/shared/task-repeat';

import { useTaskRepeatLabel } from './task-repeat-label';

const timezone = 'Europe/Zurich';

function wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children);
}

function renderLabel() {
  return renderHook(() => useTaskRepeatLabel(), { wrapper });
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('useTaskRepeatLabel', () => {
  it('names the rule in the design system’s words', async () => {
    await i18n.changeLanguage('en');
    const { result } = renderLabel();
    expect(
      result.current({
        frequency: 'weekly',
        interval: 2,
        weekdays: [4, 2],
        timezone,
      }),
    ).toBe('Every 2 weeks on Tuesday and Thursday');
    expect(
      result.current({
        frequency: 'monthly',
        interval: 1,
        monthDay: 28,
        timezone,
      }),
    ).toBe('Monthly on day 28');
  });

  // A rule that creates its next task on the due date says so; the default
  // (on close) adds nothing, whether the key is absent or spelled out.
  it('adds when the next task is created only for the due-date mode', async () => {
    await i18n.changeLanguage('en');
    const { result } = renderLabel();
    const monthly: TaskRepeat = {
      frequency: 'monthly',
      interval: 1,
      monthDay: 30,
      timezone,
    };
    expect(result.current({ ...monthly, createOn: 'dueDate' })).toBe(
      'Monthly on day 30, next task on the due date',
    );
    expect(result.current({ ...monthly, createOn: 'close' })).toBe(
      'Monthly on day 30',
    );
  });

  it('reads naturally in German and French', async () => {
    const { result } = renderLabel();
    const rule: TaskRepeat = {
      frequency: 'monthly',
      interval: 1,
      monthDay: 1,
      timezone,
      createOn: 'dueDate',
    };
    await act(async () => {
      await i18n.changeLanguage('de');
    });
    expect(result.current(rule)).toBe(
      'Monatlich am 1., nächste Aufgabe am Fälligkeitstag',
    );
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(result.current(rule)).toBe(
      "Chaque mois le 1er, tâche suivante à l'échéance",
    );
  });
});

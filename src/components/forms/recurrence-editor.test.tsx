import type { i18n as I18n } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import {
  type RecurrenceDraft,
  recurrenceDraft,
  type RecurrenceFrequency,
  type RecurrenceRule,
} from '../../lib/recurrence/rule';
import { RecurrenceEditor } from './recurrence-editor';

/** Tue Sep 29, 2026. */
const REFERENCE = { year: 2026, month: 9, day: 29, weekday: 2 };

function Harness({
  rule = null,
  onDraftChange,
  onSubmit,
  frequencies,
  maxInterval,
}: {
  rule?: RecurrenceRule | null;
  onDraftChange?: (draft: RecurrenceDraft) => void;
  onSubmit?: () => void;
  frequencies?: readonly RecurrenceFrequency[];
  maxInterval?: number;
}) {
  const [draft, setDraft] = useState(() => recurrenceDraft(rule, REFERENCE));
  return (
    <RecurrenceEditor
      aria-label="Custom"
      draft={draft}
      onDraftChange={(next) => {
        setDraft(next);
        onDraftChange?.(next);
      }}
      onSubmit={onSubmit}
      frequencies={frequencies}
      maxInterval={maxInterval}
    />
  );
}

describe('RecurrenceEditor', () => {
  it('is a named group with a unit choice and a named interval', async () => {
    const { container } = render(<Harness />);
    expect(screen.getByRole('group', { name: 'Custom' })).toBeVisible();
    expect(screen.getByRole('radiogroup', { name: 'Unit' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // The field's name reads as the sentence around it.
    expect(
      screen.getByRole('spinbutton', { name: 'Every 1 week' }),
    ).toHaveValue('1');
    expect(screen.getByRole('group', { name: 'On' })).toBeVisible();
    await checkAccessibility(container);
  });

  it('keeps each unit’s anchor when the unit changes', async () => {
    const onDraftChange = vi.fn();
    const { user } = render(<Harness onDraftChange={onDraftChange} />);
    await user.click(screen.getByRole('radio', { name: 'Month' }));
    const day = screen.getByRole('spinbutton', { name: 'On day 29' });
    await user.click(day);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.click(screen.getByRole('radio', { name: 'Week' }));
    await user.click(screen.getByRole('button', { name: 'Thursday' }));
    await user.click(screen.getByRole('radio', { name: 'Month' }));
    expect(screen.getByRole('spinbutton', { name: 'On day 27' })).toBeVisible();
    expect(onDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        frequency: 'monthly',
        monthDay: 27,
        weekdays: [2, 4],
      }),
    );
  });

  it('shares the interval between units', async () => {
    const { user } = render(<Harness />);
    const interval = screen.getByRole('spinbutton', { name: 'Every 1 week' });
    await user.click(interval);
    await user.keyboard('{ArrowUp}');
    expect(
      screen.getByRole('spinbutton', { name: 'Every 2 weeks' }),
    ).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Year' }));
    expect(
      screen.getByRole('spinbutton', { name: 'Every 2 years' }),
    ).toBeVisible();
  });

  it('keeps one weekday on', async () => {
    const onDraftChange = vi.fn();
    const { user } = render(<Harness onDraftChange={onDraftChange} />);
    const tuesday = screen.getByRole('button', { name: 'Tuesday' });
    await user.click(tuesday);
    expect(tuesday).toHaveAttribute('aria-pressed', 'true');
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it('explains days that shorter months lack', async () => {
    const { user } = render(
      <Harness rule={{ frequency: 'monthly', interval: 1, monthDay: 28 }} />,
    );
    expect(
      screen.queryByText('Shorter months use their last day.'),
    ).not.toBeInTheDocument();
    const day = screen.getByRole('spinbutton', { name: 'On day 28' });
    await user.click(day);
    await user.keyboard('{ArrowUp}');
    expect(day).toHaveAccessibleDescription(
      'Shorter months use their last day.',
    );
  });

  it('names the day by its month and explains February 29', async () => {
    const { user } = render(
      <Harness
        rule={{ frequency: 'yearly', interval: 1, month: 2, monthDay: 29 }}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveTextContent(
      'February',
    );
    const day = screen.getByRole('spinbutton', { name: 'On February 29' });
    expect(day).toHaveAttribute('aria-valuemax', '29');
    expect(day).toHaveAccessibleDescription(
      'In other years, this falls on Feb 28.',
    );
    await user.click(day);
    await user.keyboard('{ArrowDown}');
    expect(
      screen.queryByText('In other years, this falls on Feb 28.'),
    ).not.toBeInTheDocument();
  });

  it('puts the day before the month where the language does', async () => {
    // The i18n instance is shared by every test in this file; hand it back
    // in English afterwards.
    const shared: { i18n?: I18n } = {};
    function CaptureI18n() {
      const { i18n } = useTranslation();
      useEffect(() => {
        shared.i18n = i18n;
      }, [i18n]);
      return null;
    }
    localStorage.setItem('user-locale', 'de');
    try {
      render(
        <>
          <CaptureI18n />
          <Harness
            rule={{ frequency: 'yearly', interval: 1, month: 2, monthDay: 29 }}
          />
        </>,
      );
      const day = await screen.findByRole('spinbutton', {
        name: 'Am 29 Februar',
      });
      const month = screen.getByRole('combobox', { name: 'Monat' });
      expect(
        day.compareDocumentPosition(month) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(day).toHaveAccessibleDescription(/^In anderen Jahren gilt/);
    } finally {
      localStorage.removeItem('user-locale');
      // Unmounted first: while the tree lives, it holds the language at the
      // German it detected.
      cleanup();
      await shared.i18n?.changeLanguage('en-US');
    }
  });

  it('announces the settled rule, not every step', async () => {
    const { user } = render(<Harness />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Weekly on Tuesday');
    await user.click(screen.getByRole('button', { name: 'Thursday' }));
    expect(status).toHaveTextContent('Weekly on Tuesday');
    await waitFor(() =>
      expect(status).toHaveTextContent('Weekly on Tuesday and Thursday'),
    );
  });

  it('calls onSubmit on Enter in a number field', async () => {
    const onSubmit = vi.fn();
    const { user } = render(<Harness onSubmit={onSubmit} />);
    await user.click(screen.getByRole('spinbutton', { name: 'Every 1 week' }));
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('offers only the units and the step it is given', async () => {
    const { user } = render(
      <Harness frequencies={['weekly', 'monthly']} maxInterval={4} />,
    );
    expect(
      screen.getAllByRole('radio').map((radio) => radio.textContent),
    ).toEqual(['Week', 'Month']);
    const interval = screen.getByRole('spinbutton', { name: 'Every 1 week' });
    expect(interval).toHaveAttribute('aria-valuemax', '4');
    await user.click(interval);
    await user.keyboard('{End}');
    expect(interval).toHaveValue('4');
  });
});

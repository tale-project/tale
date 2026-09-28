import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { DatePicker } from './date-picker';

import '../../globals.css';

// Real-Chromium coverage for what jsdom cannot judge: which control a
// keyboard user sees focused, and axe's layout-dependent rules.
afterEach(() => {
  cleanup();
  localStorage.removeItem('user-locale');
  document.documentElement.classList.remove('dark');
});

const SEP_29_2026 = new Date(2026, 8, 29).getTime();

/** Tailwind draws focus rings as box-shadows. */
function hasRing(el: Element): boolean {
  return getComputedStyle(el).boxShadow !== 'none';
}

describe('DatePicker focus (real layout)', () => {
  it.each(['default', 'ghost'] as const)(
    'rings only the %s control that holds the focus',
    async (variant) => {
      const { user } = render(
        <div className="w-64 p-8">
          <DatePicker
            value={SEP_29_2026}
            onChange={() => {}}
            variant={variant}
          />
        </div>,
      );
      const trigger = screen.getByRole('button', { name: 'Sep 29, 2026' });
      const clear = screen.getByRole('button', { name: 'Clear date' });
      const field = trigger.parentElement;
      expect(field).not.toBeNull();
      const fieldShadowAtRest = getComputedStyle(field!).boxShadow;
      expect(hasRing(clear)).toBe(false);

      await user.tab();
      expect(trigger).toHaveFocus();
      expect(getComputedStyle(field!).boxShadow).not.toBe(fieldShadowAtRest);

      await user.tab();
      expect(clear).toHaveFocus();
      expect(hasRing(clear)).toBe(true);
      expect(getComputedStyle(field!).boxShadow).toBe(fieldShadowAtRest);
    },
  );

  it('passes axe with a date set', async () => {
    const { container } = render(
      <div className="bg-background p-8">
        <DatePicker value={SEP_29_2026} onChange={() => {}} />
      </div>,
    );
    const result = await axe.run(container, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    });
    expect(result.violations).toEqual([]);
  });
});

function ControlledPicker({
  onChange,
}: {
  onChange: (next: number | null) => void;
}) {
  const [value, setValue] = useState<number | undefined>(SEP_29_2026);
  return (
    <DatePicker
      value={value}
      onChange={(next) => {
        setValue(next ?? undefined);
        onChange(next);
      }}
    />
  );
}

describe.each([
  { width: 390, theme: 'dark' },
  { width: 1280, theme: 'light' },
])(
  'localized date selection and clear at $width in $theme',
  ({ width, theme }) => {
    it.each([
      [
        'en-US',
        'Sep 29, 2026',
        'Sep 30, 2026',
        'Choose',
        'Month',
        'Clear date',
        'Pick a date',
      ],
      [
        'de',
        '29. Sep. 2026',
        '30. Sep. 2026',
        'Wähle',
        'Monat',
        'Datum entfernen',
        'Datum wählen',
      ],
      [
        'de-CH',
        '29. Sep. 2026',
        '30. Sep. 2026',
        'Wähle',
        'Monat',
        'Datum entfernen',
        'Datum wählen',
      ],
      [
        'fr',
        '29 sept. 2026',
        '30 sept. 2026',
        'Choisir',
        'Mois',
        'Effacer la date',
        'Choisir une date',
      ],
    ])(
      '%s selects a local day and clears with the native keyboard',
      async (locale, initial, selected, choose, month, clear, placeholder) => {
        await page.viewport(width, 844);
        document.documentElement.classList.toggle('dark', theme === 'dark');
        localStorage.setItem('user-locale', locale);
        const onChange = vi.fn();
        render(
          <div className="bg-background p-4">
            <ControlledPicker onChange={onChange} />
          </div>,
        );
        const trigger = await screen.findByRole('button', { name: initial });
        await userEvent.tab();
        expect(trigger).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        const nextDay = await screen.findByRole('gridcell', {
          name: new RegExp('^' + choose + '(?=.*[Ss]ept)(?=.*30).*2026$'),
        });
        expect(
          screen.getByRole('rowgroup', { name: new RegExp('^' + month + ' ') }),
        ).toBeVisible();
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        await userEvent.click(nextDay);
        expect(onChange).toHaveBeenCalledExactlyOnceWith(
          new Date(2026, 8, 30).getTime(),
        );
        const selectedTrigger = screen.getByRole('button', { name: selected });
        await expect.poll(() => document.activeElement).toBe(selectedTrigger);
        await userEvent.tab();
        expect(screen.getByRole('button', { name: clear })).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        expect(onChange).toHaveBeenLastCalledWith(null);
        expect(
          screen.queryByRole('button', { name: clear }),
        ).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: placeholder })).toHaveFocus();
        expect(document.querySelector('.react-datepicker')).toBeNull();
      },
    );
  },
);

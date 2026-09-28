import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { DatePicker } from './date-picker';

import '../../globals.css';

// Real-Chromium coverage for what jsdom cannot judge: which control a
// keyboard user sees focused, and axe's layout-dependent rules.
afterEach(cleanup);

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

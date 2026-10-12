import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { CalendarDays, SignalMedium } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { PropertyChip } from './property-chip';

import '../../globals.css';

// Real-Chromium coverage for the chip row under a create form: 32px pills
// that wrap in a narrow column, truncate a long value inside the column,
// show a focus ring, and read at AA contrast set or unset, in both themes.

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

function ChipRow({ width }: { width: number }) {
  return (
    <div
      data-testid="row"
      className="bg-background flex flex-wrap gap-2 p-2"
      style={{ width }}
    >
      <PropertyChip icon={<SignalMedium />}>Medium</PropertyChip>
      <PropertyChip icon={<CalendarDays />}>Today</PropertyChip>
      <PropertyChip empty>Due date</PropertyChip>
      <PropertyChip icon={<CalendarDays />}>
        A value far longer than any column it could sit in
      </PropertyChip>
    </div>
  );
}

describe('PropertyChip layout', () => {
  it('draws 32px pills that wrap and truncate inside a narrow column', async () => {
    await page.viewport(390, 844);
    render(<ChipRow width={240} />);
    const row = screen.getByTestId('row');
    const rowBox = row.getBoundingClientRect();
    const chips = screen.getAllByRole('button');
    for (const chip of chips) {
      const box = chip.getBoundingClientRect();
      expect(box.height).toBeCloseTo(32, 0);
      expect(box.right).toBeLessThanOrEqual(rowBox.right);
    }
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
    // More than one line: the row wrapped.
    const tops = new Set(
      chips.map((chip) => Math.round(chip.getBoundingClientRect().top)),
    );
    expect(tops.size).toBeGreaterThan(1);
    const long = screen.getByRole('button', { name: /^A value far longer/ });
    const text = long.lastElementChild as HTMLElement;
    expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);
  });

  it('shows a focus ring from the keyboard', async () => {
    await page.viewport(1024, 768);
    render(<ChipRow width={600} />);
    await userEvent.tab();
    const chip = screen.getByRole('button', { name: 'Medium' });
    expect(chip).toHaveFocus();
    expect(getComputedStyle(chip).boxShadow).not.toBe('none');
  });
});

describe.each(['light', 'dark'])('PropertyChip in %s', (theme) => {
  it('passes axe, contrast included, set and unset', async () => {
    await page.viewport(1024, 768);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = render(<ChipRow width={600} />);
    const result = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
      },
    });
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
  });
});

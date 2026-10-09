import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { PropertyDivider, PropertyList, PropertyRow } from './property-list';

import '../../globals.css';

// Real-Chromium coverage for what jsdom cannot lay out: a German label longer
// than its column wraps inside it, every row keeps its height in a
// height-constrained panel, and `stacked="md"` follows the dialog's switch
// between a phone's drawer and a desktop dialog.

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

/** A value control as tall as the pickers a property panel holds. */
function Control({ children }: { children: string }) {
  return (
    <button type="button" className="h-7 w-full truncate text-left text-sm">
      {children}
    </button>
  );
}

describe('PropertyList layout', () => {
  it('wraps a long German label inside its column, beside its value', async () => {
    await page.viewport(1280, 800);
    render(
      <div lang="de">
        <PropertyList className="w-[17rem]" data-testid="panel">
          <PropertyRow label="Fälligkeitsdatum der Aufgabe">
            <Control>12. Okt. 2026</Control>
          </PropertyRow>
        </PropertyList>
      </div>,
    );
    const label = screen.getByText('Fälligkeitsdatum der Aufgabe');
    const value = screen.getByRole('button', { name: '12. Okt. 2026' });
    const labelBox = label.getBoundingClientRect();
    expect(labelBox.width).toBeCloseTo(80, 0);
    // Two lines or more: it wrapped instead of running under its value.
    expect(labelBox.height).toBeGreaterThan(28);
    expect(labelBox.right).toBeLessThanOrEqual(
      value.getBoundingClientRect().left,
    );
    const panel = screen.getByTestId('panel');
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  });

  // English has no hyphenation here: a single word wider than the column
  // must still break inside it.
  it('breaks a single word too long for the column inside it', async () => {
    await page.viewport(1280, 800);
    render(
      <PropertyList className="w-[17rem]" data-testid="panel">
        <PropertyRow label="Responsibilities">
          <Control>Ada Lovelace</Control>
        </PropertyRow>
      </PropertyList>,
    );
    const label = screen.getByText('Responsibilities');
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
    expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(
      screen
        .getByRole('button', { name: 'Ada Lovelace' })
        .getBoundingClientRect().left,
    );
  });

  it('centres a one-line label on its control', async () => {
    await page.viewport(1280, 800);
    render(
      <PropertyList className="w-[17rem]">
        <PropertyRow label="Status">
          <Control>In progress</Control>
        </PropertyRow>
      </PropertyList>,
    );
    const label = screen.getByText('Status').getBoundingClientRect();
    const value = screen
      .getByRole('button', { name: 'In progress' })
      .getBoundingClientRect();
    expect(label.top + label.height / 2).toBeCloseTo(
      value.top + value.height / 2,
      0,
    );
  });

  it('keeps every row at full height in a panel that scrolls', async () => {
    await page.viewport(1280, 800);
    const names = ['Status', 'Priority', 'Assignee', 'Start date', 'Due date'];
    render(
      <PropertyList className="h-24 w-[17rem] overflow-y-auto">
        {names.map((name) => (
          <PropertyRow key={name} label={name}>
            <Control>{`${name} value`}</Control>
          </PropertyRow>
        ))}
        <PropertyDivider />
      </PropertyList>,
    );
    for (const name of names) {
      const row = screen.getByText(name).parentElement!;
      expect(row.getBoundingClientRect().height, name).toBeGreaterThanOrEqual(
        28,
      );
    }
  });

  it.each([
    { width: 1280, stacked: true },
    { width: 390, stacked: false },
  ])(
    'stacks a md row only from md up ($width px)',
    async ({ width, stacked }) => {
      await page.viewport(width, 800);
      render(
        <PropertyList className="w-full max-w-[17rem]">
          <PropertyRow label="Repeat" stacked="md">
            <Control>Weekly</Control>
          </PropertyRow>
        </PropertyList>,
      );
      const label = screen.getByText('Repeat').getBoundingClientRect();
      const value = screen
        .getByRole('button', { name: 'Weekly' })
        .getBoundingClientRect();
      if (stacked) {
        expect(value.top).toBeGreaterThanOrEqual(label.bottom);
      } else {
        // In the row layout's 80px label column.
        const column = screen.getByText('Repeat').parentElement!;
        expect(column.getBoundingClientRect().width).toBeCloseTo(80, 0);
        expect(value.left).toBeGreaterThanOrEqual(
          column.getBoundingClientRect().right,
        );
      }
    },
  );
});

describe.each(['light', 'dark'])('PropertyList in %s', (theme) => {
  it('passes axe, contrast included', async () => {
    await page.viewport(1280, 800);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = render(
      <div className="bg-background p-4">
        <PropertyList as="aside" aria-label="Details" className="w-[17rem]">
          <PropertyRow label="Status">
            <Control>In progress</Control>
          </PropertyRow>
          <PropertyDivider />
          <PropertyRow label="Labels" stacked>
            <span className="text-sm">Launch</span>
          </PropertyRow>
        </PropertyList>
      </div>,
    );
    const result = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
      },
    });
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
  });
});

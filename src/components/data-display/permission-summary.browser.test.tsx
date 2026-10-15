import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { ratioAgainst } from '@/tests/utils/contrast';
import { render, screen } from '@/tests/utils/render';

import { PermissionSummary } from './permission-summary';

import '../../globals.css';

// Real-Chromium coverage for what jsdom cannot see: a long label wraps inside
// a phone-width column instead of overflowing it, the words that carry each
// state are heard but not seen, and the check, the dash and the words keep
// their contrast in both themes.

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

const ITEMS = [
  { label: 'Read automations, their runs and their versions', allowed: true },
  {
    label: 'Edit automations',
    allowed: false,
    detail: 'Your role in Acme does not allow this.',
  },
] as const;

describe('PermissionSummary layout', () => {
  it('wraps a very long unbroken label inside a 320px column', async () => {
    await page.viewport(320, 640);
    const long = 'Verwaltungsvorschriftenänderungsbefugnisse'.repeat(3);
    render(
      <div className="w-[17.5rem]" data-testid="column">
        <PermissionSummary
          title="What it can do"
          items={[
            { label: long, allowed: true, detail: long },
            { label: 'Short', allowed: false },
          ]}
          footer={long}
        />
      </div>,
    );
    const column = screen.getByTestId('column');
    expect(column.scrollWidth).toBeLessThanOrEqual(column.clientWidth);
    for (const text of screen.getAllByText(long)) {
      expect(text.getBoundingClientRect().right).toBeLessThanOrEqual(
        column.getBoundingClientRect().right,
      );
    }
  });

  it('keeps its icons beside the first line of a label that wraps', async () => {
    await page.viewport(320, 640);
    render(
      <div className="w-[17.5rem]">
        <PermissionSummary
          items={[
            {
              label:
                'Read every automation of the organization, its runs and its versions',
              allowed: true,
            },
          ]}
        />
      </div>,
    );
    const row = screen.getByRole('listitem');
    const icon = row.querySelector('svg')!.getBoundingClientRect();
    const label = row.lastElementChild!.getBoundingClientRect();
    expect(label.height).toBeGreaterThan(28);
    expect(icon.top).toBeLessThan(label.top + 12);
    expect(icon.bottom).toBeLessThan(label.top + 28);
  });

  it('does not paint the words that carry the state, and still reads them', async () => {
    await page.viewport(800, 600);
    render(<PermissionSummary items={ITEMS} />);
    const words = screen.getByText('Not allowed:');
    const box = words.getBoundingClientRect();
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent(
      /^Not allowed: Edit automations/,
    );
  });
});

describe('PermissionSummary colour', () => {
  it.each(['light', 'dark'])(
    'passes axe, and its check, dash and words stay readable (%s)',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      await page.viewport(800, 600);
      const { container } = render(
        <div className="bg-background p-4">
          <PermissionSummary
            title="What Claude Code can do"
            items={ITEMS}
            footer="Limited by your role, Developer."
          />
        </div>,
      );
      const result = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      });
      expect(result.violations).toEqual([]);
      // Text needs 4.5:1; the check and the dash are glyphs, 3:1.
      for (const text of container.querySelectorAll<HTMLElement>(
        'li > span, p',
      )) {
        expect(
          ratioAgainst(text, getComputedStyle(text).color),
          `${theme} "${text.textContent}"`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      for (const glyph of container.querySelectorAll<SVGElement>('li > svg')) {
        expect(
          ratioAgainst(glyph, getComputedStyle(glyph).color),
          `${theme} glyph`,
        ).toBeGreaterThanOrEqual(3);
      }
    },
  );
});

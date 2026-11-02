import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { render, screen, waitFor, within } from '@/tests/utils/render';

import type { SchemaTreeSchema } from '../../../data/infer-schema';
import { DataView } from './data-view';

import '../../../globals.css';

// Real-Chromium coverage: the Values / Shape switch from the keyboard, the
// expected-shape verdict and its marks, full screen returning focus to its
// trigger, the toolbar on one row at a narrow inspector width, and AA in
// both themes.

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

const OUTPUT = {
  summary: 'Login fails on Safari',
  score: 7,
  labels: [{ name: 'bug' }, { name: 'ui', color: 'red' }],
  extra: true,
};

const EXPECTED: SchemaTreeSchema = {
  type: 'object',
  required: ['summary', 'score', 'priority'],
  properties: {
    summary: { type: 'string' },
    score: { type: 'number' },
    priority: { enum: ['low', 'high'] },
    labels: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, color: { type: 'string' } },
      },
    },
  },
};

describe('DataView', () => {
  it('switches Values and Shape from the keyboard', async () => {
    render(<DataView value={OUTPUT} aria-label="Returned" />);
    await userEvent.click(screen.getByRole('radio', { name: 'Values' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Shape' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.getByRole('list', { name: 'Returned' })).toBeInTheDocument();
  });

  it('marks how the value differs from its expected shape', async () => {
    render(
      <DataView value={OUTPUT} aria-label="Returned" expected={EXPECTED} />,
    );
    expect(
      screen.getByText('Differs from the expected shape in 2 fields'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }));
    const fields = screen.getByRole('list', { name: 'Returned' });
    expect(
      within(fields).getByText('priority').nextElementSibling,
    ).toHaveTextContent('expected, but not there');
    expect(
      within(fields).getByText('extra').nextElementSibling,
    ).toHaveTextContent('not in the expected shape');
  });

  it('opens full screen and gives focus back to its button on close', async () => {
    await page.viewport(1280, 800);
    render(
      <DataView
        value={OUTPUT}
        aria-label="Returned"
        toolbar={{ fullScreen: true, download: { fileName: 'returned.json' } }}
      />,
    );
    const open = screen.getByRole('button', { name: 'Open full screen' });
    await userEvent.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Returned' });
    expect(within(dialog).getByRole('tree')).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Open full screen' }),
    ).toBeNull();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(open).toHaveFocus());
  });

  it('keeps the switch and the toolbar on one row at 22rem', async () => {
    await page.viewport(1280, 800);
    render(
      <div style={{ width: '22rem' }}>
        <DataView
          value={OUTPUT}
          aria-label="Returned"
          density="compact"
          toolbar={{ fullScreen: true, download: { fileName: 'r.json' } }}
        />
      </div>,
    );
    const values = screen.getByRole('radio', { name: 'Values' });
    const fullScreen = screen.getByRole('button', { name: 'Open full screen' });
    expect(
      Math.abs(
        values.getBoundingClientRect().top -
          fullScreen.getBoundingClientRect().top,
      ),
    ).toBeLessThan(8);
  });
});

describe.each(['light', 'dark'])('DataView colours (%s)', (theme) => {
  it.each(['bg-background', 'bg-card', 'bg-bg-elevated'])(
    'reads at AA on %s in both modes',
    async (surface) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = render(
        <div className={`${surface} p-4`}>
          <DataView
            value={OUTPUT}
            aria-label="Returned"
            expected={EXPECTED}
            expectedLabel="From the analysis of v4"
            recorded={{
              redacted: ['/summary'],
              bytes: 512,
            }}
          />
        </div>,
      );
      const rules = {
        runOnly: [
          'color-contrast',
          'button-name',
          'aria-required-children',
          'list',
        ],
      };
      let result = await axe.run(container, rules);
      expect(result.violations).toEqual([]);
      await userEvent.click(screen.getByRole('radio', { name: 'Shape' }));
      // Judge the settled view, not the swap fade on its way in.
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished),
      );
      result = await axe.run(container, rules);
      expect(result.violations).toEqual([]);
    },
  );
});

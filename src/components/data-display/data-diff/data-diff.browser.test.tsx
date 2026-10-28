import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { render, screen, waitFor, within } from '@/tests/utils/render';

import { DataDiff, type DataDiffLayout } from './data-diff';

import '../../../globals.css';

// Real-Chromium coverage for what jsdom cannot lay out: the side-by-side
// layout only from a 48rem container, its two trees scrolling together by
// pointer, the list at a phone's width, and the change tints at AA.

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

const BEFORE = {
  title: 'Fix login',
  amount: 250,
  draft: 'old',
  labels: 'bug',
  owner: { name: 'Ada', team: 'core' },
};
const AFTER = {
  title: 'Fix login bug',
  amount: 250,
  labels: ['bug', 'ui', 'docs'],
  owner: { name: 'Ada', team: 'web' },
  score: 7,
};

function LayoutHost({ width }: { width: string }) {
  const [layout, setLayout] = useState<DataDiffLayout>('split');
  return (
    <div style={{ width }}>
      <DataDiff
        before={BEFORE}
        after={AFTER}
        layout={layout}
        onLayoutChange={setLayout}
        labels={{ before: 'Run A', after: 'Run B' }}
        aria-label="Changes"
      />
    </div>
  );
}

describe('DataDiff layouts', () => {
  it('sets the two values side by side from 48rem, with their changes marked', async () => {
    await page.viewport(1280, 900);
    render(<LayoutHost width="900px" />);
    const before = await screen.findByRole('tree', { name: 'Changes: Run A' });
    const after = screen.getByRole('tree', { name: 'Changes: Run B' });
    expect(before.getBoundingClientRect().right).toBeLessThanOrEqual(
      after.getBoundingClientRect().left,
    );
    expect(
      within(after).getByRole('treeitem', {
        name: 'Changed from "Fix login": title, "Fix login bug"',
      }),
    ).toBeInTheDocument();
    expect(
      within(after).getByRole('treeitem', { name: 'Added: score, 7' }),
    ).toBeInTheDocument();
    expect(
      within(before).getByRole('treeitem', { name: 'Removed: draft, "old"' }),
    ).toBeInTheDocument();
    // The switch goes back to the sentences.
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(screen.queryByRole('tree')).toBeNull();
    expect(
      screen.getByText('owner.team', { selector: 'code' }),
    ).toBeInTheDocument();
  });

  it('shows the list below 48rem, without the layout switch', async () => {
    await page.viewport(375, 800);
    render(<LayoutHost width="343px" />);
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Changes' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('radio', { name: 'List' })).toBeNull();
    const group = screen.getByRole('group', { name: 'Changes' });
    expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth);
  });

  it('scrolls the two trees together, by the place they show', async () => {
    await page.viewport(1280, 900);
    const list = (offset: number) =>
      Object.fromEntries(
        Array.from({ length: 120 }, (_, index) => [
          `field${String(index).padStart(3, '0')}`,
          index + offset * (index % 7 === 0 ? 1 : 0),
        ]),
      );
    render(
      <div style={{ width: '900px' }}>
        <DataDiff
          before={{ head: 'x', ...list(0) }}
          after={{ ...list(1) }}
          layout="split"
          aria-label="Changes"
        />
      </div>,
    );
    const before = await screen.findByRole('tree', { name: 'Changes: Before' });
    const after = screen.getByRole('tree', { name: 'Changes: After' });
    // "head" only stands in Before, so the same field sits lower there.
    before.scrollTop = 1000;
    before.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(after.scrollTop).toBeGreaterThan(0));
    const topRow = (tree: HTMLElement) =>
      [...tree.querySelectorAll<HTMLElement>('[data-pointer]')].find(
        (row) => row.offsetTop + row.offsetHeight > tree.scrollTop,
      )?.dataset.pointer;
    expect(topRow(after)).toBe(topRow(before));
  });
});

describe.each(['light', 'dark'])('DataDiff colours (%s)', (theme) => {
  it.each(['bg-background', 'bg-card'])(
    'reads at AA on %s, as a list and side by side',
    async (surface) => {
      await page.viewport(1280, 900);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = render(
        <div className={`${surface} p-4`} style={{ width: '960px' }}>
          <DataDiff before={BEFORE} after={AFTER} aria-label="As a list" />
          <DataDiff
            before={BEFORE}
            after={AFTER}
            layout="split"
            aria-label="Side by side"
          />
        </div>,
      );
      await screen.findByRole('tree', { name: 'Side by side: After' });
      await userEvent.click(
        screen.getByRole('button', { name: '2 unchanged fields' }),
      );
      const result = await axe.run(container, {
        runOnly: [
          'color-contrast',
          'list',
          'listitem',
          'aria-required-children',
          'button-name',
        ],
      });
      expect(result.violations).toEqual([]);
    },
  );
});

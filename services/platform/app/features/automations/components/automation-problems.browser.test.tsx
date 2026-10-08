import '@testing-library/jest-dom/vitest';
import type { IssueItem } from '@tale/ui/issue-list';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { cleanup, render, screen, within } from '@/tests/utils/render';

import { AutomationProblemsSheet } from './automation-problems';

import '@/app/globals.css';

// Real-Chromium layout of the Problems sheet's chrome: its "Hide problems"
// close is the dialog family's 32px corner button, and the title row keeps
// clear of it on a tablet's dialog and a phone's drawer.

afterEach(cleanup);

const ITEMS: IssueItem[] = [
  {
    id: 'unknown-node',
    severity: 'error',
    title: 'Reads a node that does not exist',
    location: 'Draft reply › Prompt',
  },
];

function intersects(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

describe.each([
  { device: 'tablet', width: 900 },
  { device: 'phone', width: 390 },
])('AutomationProblemsSheet chrome ($device)', ({ width }) => {
  it('keeps the title clear of the 32px close', async () => {
    await page.viewport(width, 844);
    render(
      <AutomationProblemsSheet
        open
        onOpenChange={() => {}}
        items={ITEMS}
        counts={{ errors: 1, warnings: 0 }}
        status="ready"
        activeId={null}
        onActivate={() => {}}
        filter="all"
        onFilterChange={() => {}}
        listRef={createRef()}
        handingOn={false}
      />,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Problems' });
    // Measured at rest: the dialog zooms in from 95 %.
    await Promise.all(
      sheet.getAnimations().map((animation) => animation.finished),
    );
    const close = within(sheet).getByRole('button', { name: 'Hide problems' });
    const closeBox = close.getBoundingClientRect();
    expect(closeBox.width).toBeCloseTo(32, 0);
    expect(closeBox.height).toBeCloseTo(32, 0);
    const title = within(sheet).getByText('Problems');
    const range = document.createRange();
    range.selectNodeContents(title);
    for (const line of Array.from(range.getClientRects())) {
      expect(intersects(line, closeBox)).toBe(false);
    }
  });
});

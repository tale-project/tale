import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { cleanup, render, screen, within } from '@/tests/utils/render';

import { TaskRunDetailsDialog } from './task-run-details-dialog';

import '@/app/globals.css';

// Real-Chromium layout of the run dialog's chrome: Close is the dialog
// family's 32px corner button, and a long run name in the title wraps
// before it instead of running under it, on a desktop dialog and a phone's
// drawer alike.

vi.mock('./task-run-details-content', () => ({
  TaskRunDetailsContent: () => <ol aria-label="steps" />,
}));

afterEach(cleanup);

function intersects(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

describe.each([
  { device: 'desktop', width: 1280 },
  { device: 'phone', width: 390 },
])('TaskRunDetailsDialog chrome ($device)', ({ width }) => {
  it('wraps a long title before the 32px close', async () => {
    await page.viewport(width, 844);
    const name =
      'Synchronise every open customer ticket from the support mailbox into the project board';
    render(
      <TaskRunDetailsDialog
        organizationId="org-1"
        projectId="proj-1"
        automationSlug="mail-sync"
        runId="run-1"
        name={name}
        live
        open
        onOpenChange={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    // Measured at rest: the dialog zooms in from 95 %.
    await Promise.all(
      dialog.getAnimations().map((animation) => animation.finished),
    );
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const closeBox = close.getBoundingClientRect();
    expect(closeBox.width).toBeCloseTo(32, 0);
    expect(closeBox.height).toBeCloseTo(32, 0);
    const title = within(dialog).getByRole('heading');
    const range = document.createRange();
    range.selectNodeContents(title);
    const lines = Array.from(range.getClientRects());
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(intersects(line, closeBox)).toBe(false);
    }
  });
});

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { Maximize2 } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { render, screen, waitFor, within } from '@/tests/utils/render';

import { IconButton } from '../primitives/icon-button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from './responsive-dialog';

import '@tale/ui/globals.css';

// Real-Chromium coverage for the dialog's chrome: the header actions and
// Close as one 32px cluster in the corner, on the centred dialog and on the
// phone's drawer, where the cluster must never cover the content.
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

function Harness({ tall = false }: { tall?: boolean }) {
  return (
    <ResponsiveDialog open onOpenChange={() => {}}>
      <ResponsiveDialogContent
        className="max-w-3xl"
        headerActions={
          <IconButton
            asChild
            slotChild={<a href="#task-page" aria-label="Open as page" />}
            icon={Maximize2}
            size="sm"
            aria-label="Open as page"
          />
        }
      >
        <ResponsiveDialogTitle>
          Review the launch checklist
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>Task details</ResponsiveDialogDescription>
        <button type="button">Inside</button>
        {tall && <div style={{ height: 2000 }} data-testid="tall" />}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function cluster() {
  const dialog = screen.getByRole('dialog');
  return {
    dialog,
    action: within(dialog).getByRole('link', { name: 'Open as page' }),
    close: within(dialog).getByRole('button', { name: 'Close' }),
  };
}

async function settled(dialog: HTMLElement) {
  await Promise.all(
    dialog.getAnimations().map((animation) => animation.finished),
  );
}

describe('ResponsiveDialog chrome (desktop)', () => {
  it('sets the actions and Close as one 32px row in the corner', async () => {
    await page.viewport(1280, 800);
    render(<Harness />);
    const { dialog, action, close } = cluster();
    await settled(dialog);
    const box = dialog.getBoundingClientRect();
    const actionBox = action.getBoundingClientRect();
    const closeBox = close.getBoundingClientRect();
    expect(closeBox.width).toBeCloseTo(32, 0);
    expect(closeBox.height).toBeCloseTo(32, 0);
    expect(actionBox.height).toBeCloseTo(32, 0);
    expect(actionBox.top).toBeCloseTo(closeBox.top, 0);
    expect(actionBox.right).toBeLessThanOrEqual(closeBox.left);
    // 12px inside the panel's 1px border.
    expect(box.right - closeBox.right).toBeCloseTo(13, 0);
    expect(closeBox.top - box.top).toBeCloseTo(13, 0);
  });

  it('tabs from the content to the actions and ends on Close', async () => {
    await page.viewport(1280, 800);
    render(<Harness />);
    const { action, close } = cluster();
    screen.getByRole('button', { name: 'Inside' }).focus();
    await userEvent.tab();
    expect(action).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();
  });
});

describe('ResponsiveDialog chrome (phone drawer)', () => {
  it('keeps the cluster in its own band above the content', async () => {
    await page.viewport(390, 844);
    render(<Harness />);
    const { dialog, action, close } = cluster();
    await settled(dialog);
    const box = dialog.getBoundingClientRect();
    const closeBox = close.getBoundingClientRect();
    const actionBox = action.getBoundingClientRect();
    expect(closeBox.width).toBeCloseTo(32, 0);
    expect(closeBox.height).toBeCloseTo(32, 0);
    expect(closeBox.right).toBeLessThanOrEqual(390);
    expect(box.right - closeBox.right).toBeCloseTo(8, 0);
    expect(actionBox.top).toBeCloseTo(closeBox.top, 0);
    expect(actionBox.right).toBeLessThanOrEqual(closeBox.left);
    const title = screen.getByText('Review the launch checklist');
    expect(title.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      closeBox.bottom,
    );
  });

  it('never lets scrolled content pass under the cluster', async () => {
    await page.viewport(390, 844);
    render(<Harness tall />);
    const { dialog, close } = cluster();
    await settled(dialog);
    const tall = screen.getByTestId('tall');
    const scroller = tall.parentElement!;
    scroller.scrollTop = 400;
    await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));
    expect(scroller.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      close.getBoundingClientRect().bottom,
    );
  });
});

describe.each([
  { theme: 'light', width: 1280 },
  { theme: 'dark', width: 1280 },
  { theme: 'light', width: 390 },
  { theme: 'dark', width: 390 },
])('ResponsiveDialog chrome in $theme at $width px', ({ theme, width }) => {
  it('passes axe, contrast included', async () => {
    await page.viewport(width, 844);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    render(<Harness />);
    const { dialog } = cluster();
    await settled(dialog);
    const result = await axe.run(dialog, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
      },
    });
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
  });
});

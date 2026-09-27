import '@testing-library/jest-dom/vitest';
import { cleanup, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { DropdownMenu, type DropdownMenuGroup } from './dropdown-menu';

// Radix keeps a closed menu mounted until its exit animation ends, and during
// that window the old content is still a dismissable layer whose own trigger
// counts as "outside". The shipped stylesheet animates the exit; this test
// pins a longer one so the re-click below reliably lands inside the window
// whatever the design tokens say. Real Chromium is required: jsdom runs no
// animations, so the menu would unmount at once and the race could not occur.
const EXIT_ANIMATION_MS = 400;
let exitStyle: HTMLStyleElement;

beforeEach(() => {
  exitStyle = document.createElement('style');
  exitStyle.textContent = `
    @keyframes tale-test-menu-out { from { opacity: 1; } to { opacity: 0; } }
    [role="menu"][data-state="closed"] {
      animation: tale-test-menu-out ${EXIT_ANIMATION_MS}ms linear forwards;
    }
  `;
  document.head.append(exitStyle);
});

afterEach(() => {
  cleanup();
  exitStyle.remove();
});

function items(onPick: () => void): DropdownMenuGroup[] {
  return [[{ type: 'item', label: 'Pick', onClick: onPick }]];
}

function ControlledMenu({ onPick }: { onPick: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      trigger={<button type="button">Account</button>}
      items={items(onPick)}
    />
  );
}

/** Open the menu, pick the item, and click the trigger again while the old
 *  content is still animating out. */
async function pickThenReopen() {
  const trigger = page.getByRole('button', { name: 'Account' });
  await trigger.click();
  await waitFor(() => {
    expect(screen.getByRole('menu')).toHaveAttribute('data-state', 'open');
  });
  await page.getByRole('menuitem', { name: 'Pick' }).click();
  expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute(
    'data-state',
    'closed',
  );
  await trigger.click();
}

async function expectMenuStaysOpen() {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Account' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('menu')).toHaveAttribute('data-state', 'open');
  });
  // Outlive the old content's exit window: a late dismiss would close it.
  await new Promise((resolve) => setTimeout(resolve, EXIT_ANIMATION_MS + 100));
  expect(screen.getByRole('menu')).toHaveAttribute('data-state', 'open');
  expect(screen.getByRole('menuitem', { name: 'Pick' })).toBeVisible();
}

describe('DropdownMenu trigger during the exit animation', () => {
  it('reopens an uncontrolled menu clicked right after an item was picked', async () => {
    const onPick = vi.fn();
    render(
      <DropdownMenu
        trigger={<button type="button">Account</button>}
        items={items(onPick)}
      />,
    );

    await pickThenReopen();

    expect(onPick).toHaveBeenCalledTimes(1);
    await expectMenuStaysOpen();
  });

  it('reopens a controlled menu clicked right after an item was picked', async () => {
    const onPick = vi.fn();
    render(<ControlledMenu onPick={onPick} />);

    await pickThenReopen();

    expect(onPick).toHaveBeenCalledTimes(1);
    await expectMenuStaysOpen();
  });

  it('still closes an open menu when its trigger is clicked', async () => {
    render(
      <DropdownMenu
        trigger={<button type="button">Account</button>}
        items={items(vi.fn())}
      />,
    );
    const trigger = page.getByRole('button', { name: 'Account' });
    await trigger.click();
    await waitFor(() => {
      expect(screen.getByRole('menu')).toHaveAttribute('data-state', 'open');
    });

    await trigger.click();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Account' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });
});

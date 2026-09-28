import '@testing-library/jest-dom/vitest';
import { Dialog } from '@tale/ui/dialog/dialog';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { SessionLapseRecovery } from './session-lapse-recovery';

import '@/app/globals.css';

afterEach(cleanup);

/** A tab that chose Stay here: the standing notice is all that remains. */
const PAUSED = {
  isLapsed: true,
  open: false,
  checking: false,
  checkFailed: false,
  liveSessionVersion: 0,
  setOpen: vi.fn(),
  continueToLogIn: vi.fn(),
};

/** Whether the notice's own title is what a press at its middle meets. */
function noticeOnTop(): boolean {
  const title = screen.getByText('Your session has ended');
  const range = document.createRange();
  range.selectNodeContents(title);
  const box = range.getBoundingClientRect();
  const hit = document.elementFromPoint(
    box.left + box.width / 2,
    box.top + box.height / 2,
  );
  return title.contains(hit);
}

function Page({ dialog }: { dialog: boolean }) {
  return (
    <>
      {/* A dashboard page's header: `StickyHeader` and `PanelHeader` are
          sticky at `z-50` over the page they head. */}
      <header className="bg-background sticky top-0 z-50 h-32">
        <h1>Products</h1>
      </header>
      <main className="h-[200vh]" />
      <SessionLapseRecovery recovery={PAUSED} />
      <Dialog open={dialog} onOpenChange={vi.fn()} title="Add product">
        <input aria-label="Product name" />
      </Dialog>
    </>
  );
}

// The standing notice sat at `z-40`, under every sticky page header, which
// hid its sentence and left only its Sign in button showing below the
// header's edge.
describe('the standing session notice', () => {
  it('paints over the page header', () => {
    render(<Page dialog={false} />);
    expect(noticeOnTop()).toBe(true);
  });

  it('stays under an open dialog, whose backdrop takes the press', async () => {
    render(<Page dialog />);
    await expect
      .element(page.getByRole('dialog', { name: 'Add product' }))
      .toBeVisible();
    expect(noticeOnTop()).toBe(false);
  });
});

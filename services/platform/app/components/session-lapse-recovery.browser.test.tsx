import '@testing-library/jest-dom/vitest';
import { Button } from '@tale/ui/button';
import { Dialog } from '@tale/ui/dialog/dialog';
import { PanelHeader } from '@tale/ui/panel-header';
import { StickyHeader } from '@tale/ui/sticky-header';
import { cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import {
  SessionLapseNotice,
  SessionLapseRecovery,
} from './session-lapse-recovery';

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

const PAUSED_SENTENCE = /Your page is still open\./;

/** Whether a press at the middle of `element`'s text lands on it. */
function pressable(element: HTMLElement): boolean {
  const range = document.createRange();
  range.selectNodeContents(element);
  const box = range.getBoundingClientRect();
  const hit = document.elementFromPoint(
    box.left + box.width / 2,
    box.top + box.height / 2,
  );
  return element.contains(hit);
}

const noticeTitle = () => screen.getByText('Your session has ended');

/** The page's own header controls: the navigation at its start, an action at
 * its end — what a phone's header holds beside the title. */
function HeaderRow() {
  return (
    <>
      <Button size="sm" variant="secondary">
        Open navigation
      </Button>
      <h1 className="min-w-0 flex-1 truncate">Products</h1>
      <Button size="sm">Add product</Button>
    </>
  );
}

/** The real design-system headers a dashboard page is headed by. */
const HEADERS: Record<string, () => ReactNode> = {
  StickyHeader: () => (
    <StickyHeader>
      <div className="flex h-13 items-center gap-2 px-4">
        <HeaderRow />
      </div>
    </StickyHeader>
  ),
  PanelHeader: () => (
    <PanelHeader className="gap-2">
      <HeaderRow />
    </PanelHeader>
  ),
};

/** A page dialog, open or not, over everything the page shows. */
function PageDialog({ open }: { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={vi.fn()} title="Add product">
      <input aria-label="Product name" />
    </Dialog>
  );
}

/** A dashboard page in the shell: its alert stack, then the page under its
 * header, in a column as tall as the window. */
function ShellPage({ header, dialog }: { header: string; dialog: boolean }) {
  const Header = HEADERS[header];
  return (
    <SessionLapseRecovery recovery={PAUSED}>
      <div className="mobile-nav-shell flex h-dvh w-full flex-col overflow-hidden">
        <SessionLapseNotice />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Header />
          <div className="h-[200vh] shrink-0" />
        </main>
      </div>
      <PageDialog open={dialog} />
    </SessionLapseRecovery>
  );
}

// On a phone the notice floated over the page header at full width, covering
// its navigation and actions until the person signed in.
describe.each([
  { viewport: 'a phone', width: 375, height: 740, sentence: false },
  { viewport: 'a short window', width: 900, height: 400, sentence: false },
  { viewport: 'a desktop', width: 1280, height: 800, sentence: true },
])(
  'the standing session notice on $viewport',
  ({ width, height, sentence }) => {
    describe.each(Object.keys(HEADERS))('above a %s', (header) => {
      it('leaves the header usable and keeps Sign in within reach', async () => {
        await page.viewport(width, height);
        render(<ShellPage header={header} dialog={false} />);

        for (const control of ['Open navigation', 'Add product']) {
          expect(pressable(screen.getByRole('button', { name: control }))).toBe(
            true,
          );
        }
        expect(pressable(noticeTitle())).toBe(true);
        const [signIn, ...others] = screen.getAllByRole('button', {
          name: 'Sign in',
        });
        expect(others).toEqual([]);
        expect(pressable(signIn)).toBe(true);
        // A narrow or short viewport keeps the notice to one line; the
        // sentence stays for screen readers.
        const paused = screen.getByText(PAUSED_SENTENCE);
        expect(paused.getBoundingClientRect().width > 1).toBe(sentence);
      });

      it('stays under an open dialog, whose backdrop takes the press', async () => {
        await page.viewport(width, height);
        render(<ShellPage header={header} dialog />);
        await expect
          .element(page.getByRole('dialog', { name: 'Add product' }))
          .toBeVisible();
        expect(pressable(noticeTitle())).toBe(false);
      });
    });
  },
);

/** A dashboard page without the shell's alert stack. */
function StandalonePage({
  header,
  dialog,
}: {
  header: string;
  dialog: boolean;
}) {
  const Header = HEADERS[header];
  return (
    <SessionLapseRecovery recovery={PAUSED}>
      <Header />
      <main className="h-[200vh]" />
      <PageDialog open={dialog} />
    </SessionLapseRecovery>
  );
}

// Without an alert stack to sit in, the notice floats at `z-50`; at `z-40`
// every sticky page header hid its sentence and left only its Sign in button
// showing below the header's edge.
describe.each(Object.keys(HEADERS))(
  'the floating session notice over a %s',
  (header) => {
    it('paints over the page header', async () => {
      await page.viewport(1280, 800);
      render(<StandalonePage header={header} dialog={false} />);
      expect(pressable(noticeTitle())).toBe(true);
      expect(pressable(screen.getByText(PAUSED_SENTENCE))).toBe(true);
    });

    it('stays under an open dialog, whose backdrop takes the press', async () => {
      await page.viewport(1280, 800);
      render(<StandalonePage header={header} dialog />);
      await expect
        .element(page.getByRole('dialog', { name: 'Add product' }))
        .toBeVisible();
      expect(pressable(noticeTitle())).toBe(false);
    });
  },
);

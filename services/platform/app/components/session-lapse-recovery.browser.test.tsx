import '@testing-library/jest-dom/vitest';
import { Button } from '@tale/ui/button';
import { Dialog } from '@tale/ui/dialog/dialog';
import { FullPageCenter } from '@tale/ui/full-page-center';
import { Row } from '@tale/ui/layout';
import { PanelHeader } from '@tale/ui/panel-header';
import { StickyHeader } from '@tale/ui/sticky-header';
import { cleanup } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { ShellNotch } from '@/app/components/layout/shell-notch';
import { STANDALONE_PAGE } from '@/app/components/layout/standalone-page';
import { render, screen } from '@/tests/utils/render';

import {
  SessionLapseNotice,
  SessionLapseRecovery,
} from './session-lapse-recovery';

import '@/app/globals.css';
import '@/app/locals.css';

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--safe-top');
});

/** Render as the app mounts: in `#root`, which the app's stylesheets size to
 * the window and clip, so a page taller than the window cannot scroll it. */
function renderApp(ui: ReactElement) {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  return render(ui, { container: root });
}

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
/** The confirmation is open again: the notice steps aside for it, unseen. */
const ASKING = { ...PAUSED, open: true };
const SIGNED_IN = { ...PAUSED, isLapsed: false };

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
const notice = () => screen.getByRole('status');

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

/** A dashboard page in the shell: its notch strip and alert stack, then the
 * page under its header, in a column as tall as the window. The shell's own
 * notch rule is proven on the real one (`routes/dashboard/$id.tsx`,
 * `dashboard-shell.browser.test.tsx`). */
function ShellPage({
  header,
  dialog,
  recovery = PAUSED,
}: {
  header: string;
  dialog: boolean;
  recovery?: typeof PAUSED;
}) {
  const Header = HEADERS[header];
  return (
    <SessionLapseRecovery recovery={recovery}>
      <div className="mobile-nav-shell flex h-full w-full flex-col overflow-hidden">
        <ShellNotch />
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
        renderApp(<ShellPage header={header} dialog={false} />);

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
        renderApp(<ShellPage header={header} dialog />);
        await expect
          .element(page.getByRole('dialog', { name: 'Add product' }))
          .toBeVisible();
        expect(pressable(noticeTitle())).toBe(false);
      });
    });
  },
);

/** The dashboard pages outside the shell, in the frames they really use. */
const STANDALONE_PAGES: Record<string, () => ReactNode> = {
  // The organization wizard (`STANDALONE_PAGE`): exactly the window tall,
  // it scrolls itself.
  'the organization wizard': () => (
    <div className={STANDALONE_PAGE}>
      <StickyHeader>
        <div className="flex h-13 items-center gap-2 px-4">
          <HeaderRow />
        </div>
      </StickyHeader>
      <div className="h-[150vh]" />
      <Button>Last action</Button>
    </div>
  ),
  // The changelog: as tall as the frame above it, it scrolls itself, and
  // opens on a back link in the flow.
  'the changelog': () => (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <a href="#back">Back to Tale</a>
        <PanelHeader className="gap-2">
          <HeaderRow />
        </PanelHeader>
        <div className="h-[150vh]" />
        <Button>Last action</Button>
      </div>
    </div>
  ),
  // An organization the person cannot open (`FullPageCenter`, the window
  // tall).
  'access denied': () => (
    <FullPageCenter>
      <Row gap={2}>
        <HeaderRow />
        <Button>Last action</Button>
      </Row>
    </FullPageCenter>
  ),
};

function StandalonePage({
  name,
  dialog,
  recovery = PAUSED,
}: {
  name: string;
  dialog: boolean;
  recovery?: typeof PAUSED;
}) {
  const Page = STANDALONE_PAGES[name];
  return (
    <SessionLapseRecovery recovery={recovery}>
      <Page />
      <PageDialog open={dialog} />
    </SessionLapseRecovery>
  );
}

/** Scroll each scroll container around `element` to its end. */
function scrollToEnd(element: HTMLElement) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    node.scrollTop = node.scrollHeight;
  }
}

// Without an alert stack to sit in, the notice floated over the top of the
// page and, below about 536 px, covered the changelog's back link and the
// wizard's header. It stands in the flow above the page now, and the page
// keeps the rest of the window.
describe.each([
  { viewport: 'a phone', width: 375, height: 740, sentence: false },
  { viewport: 'a short window', width: 900, height: 400, sentence: false },
  { viewport: 'a desktop', width: 1280, height: 800, sentence: true },
])(
  'the session notice above a page outside the shell, on $viewport',
  ({ width, height, sentence }) => {
    describe.each(Object.keys(STANDALONE_PAGES))('on %s', (name) => {
      it('leaves the page usable to its end and keeps Sign in within reach', async () => {
        await page.viewport(width, height);
        renderApp(<StandalonePage name={name} dialog={false} />);

        expect(getComputedStyle(notice()).position).toBe('static');
        for (const control of ['Open navigation', 'Add product']) {
          expect(pressable(screen.getByRole('button', { name: control }))).toBe(
            true,
          );
        }
        const back = screen.queryByRole('link', { name: 'Back to Tale' });
        if (back !== null) expect(pressable(back)).toBe(true);
        const [signIn, ...others] = screen.getAllByRole('button', {
          name: 'Sign in',
        });
        expect(others).toEqual([]);
        expect(pressable(signIn)).toBe(true);
        const paused = screen.getByText(PAUSED_SENTENCE);
        expect(paused.getBoundingClientRect().width > 1).toBe(sentence);

        const last = screen.getByRole('button', { name: 'Last action' });
        scrollToEnd(last);
        expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(
          window.innerHeight,
        );
        expect(pressable(last)).toBe(true);
      });

      it('stays under an open dialog, whose backdrop takes the press', async () => {
        await page.viewport(width, height);
        renderApp(<StandalonePage name={name} dialog />);
        await expect
          .element(page.getByRole('dialog', { name: 'Add product' }))
          .toBeVisible();
        expect(pressable(noticeTitle())).toBe(false);
      });
    });
  },
);

/** The notch of an installed iPhone app, as `env(safe-area-inset-top)`. */
const NOTCH = 47;

// Outside the shell the notice stands at the top of the window, and so does
// a notch strip of its own: the notice's words and the page start under the
// notch, which is cleared once, as the shell clears it above its alerts.
describe.each(Object.keys(STANDALONE_PAGES))(
  'the notch of an installed app, above %s',
  (name) => {
    it('is cleared once, by the strip above the notice', async () => {
      await page.viewport(375, 740);
      document.documentElement.style.setProperty('--safe-top', `${NOTCH}px`);
      const { rerender } = renderApp(
        <StandalonePage name={name} dialog={false} />,
      );
      const strip = document.querySelector('[data-shell-notch]');
      if (strip === null) throw new Error('no notch strip');
      expect(strip.nextElementSibling).toBe(notice());
      expect(strip.getBoundingClientRect().top).toBe(0);
      expect(strip.getBoundingClientRect().height).toBe(NOTCH);
      expect(getComputedStyle(strip).backgroundColor).toBe(
        getComputedStyle(notice()).backgroundColor,
      );
      expect(noticeTitle().getBoundingClientRect().top).toBeGreaterThanOrEqual(
        NOTCH,
      );
      expect(getComputedStyle(notice()).paddingTop).toBe('8px');
      // The page starts right under the notice.
      expect(notice().nextElementSibling?.getBoundingClientRect().top).toBe(
        notice().getBoundingClientRect().bottom,
      );

      // The confirmation hides the notice; the strip keeps its height and
      // gives back the tint the notice no longer shows.
      rerender(<StandalonePage name={name} dialog={false} recovery={ASKING} />);
      const held = screen.getByRole('status', { hidden: true });
      expect(strip.getBoundingClientRect().height).toBe(NOTCH);
      expect(getComputedStyle(strip).backgroundColor).not.toBe(
        getComputedStyle(held).backgroundColor,
      );

      // Signed in again, neither stands.
      rerender(
        <StandalonePage name={name} dialog={false} recovery={SIGNED_IN} />,
      );
      expect(document.querySelector('[data-shell-notch]')).toBeNull();
    });
  },
);

// Removed while the confirmation was open, the notice grew the page behind
// the dialog by its own height, and Stay here shrank it again: the page
// jumped under the backdrop on every Sign in and Stay here.
describe('the notice under a reopened confirmation', () => {
  /** Where the page's header stands (the page is under the dialog). */
  const headerTop = () =>
    screen
      .getByRole('button', { name: 'Open navigation', hidden: true })
      .getBoundingClientRect().top;

  it.each([
    ...Object.keys(HEADERS).map((header) => ({
      frame: `the shell above a ${header}`,
      at: (recovery: typeof PAUSED) => (
        <ShellPage header={header} dialog={false} recovery={recovery} />
      ),
    })),
    ...Object.keys(STANDALONE_PAGES).map((name) => ({
      frame: name,
      at: (recovery: typeof PAUSED) => (
        <StandalonePage name={name} dialog={false} recovery={recovery} />
      ),
    })),
  ])('keeps its place, unseen, in $frame', async ({ at }) => {
    await page.viewport(375, 740);
    const { rerender } = renderApp(at(PAUSED));
    const standing = headerTop();

    rerender(at(ASKING));
    await expect
      .element(page.getByRole('dialog', { name: 'Your session has ended' }))
      .toBeVisible();
    expect(headerTop()).toBe(standing);
    const held = screen.getByRole('status', { hidden: true });
    expect(getComputedStyle(held).visibility).toBe('hidden');
    expect(held).toHaveAttribute('aria-hidden', 'true');

    rerender(at(PAUSED));
    expect(headerTop()).toBe(standing);
    expect(pressable(noticeTitle())).toBe(true);
  });
});

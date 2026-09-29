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

import {
  ShellMobileHeader,
  ShellNotchSpacer,
} from '@/app/components/layout/shell-mobile-header';
import { STANDALONE_PAGE } from '@/app/components/layout/standalone-page';
import {
  AbilityContext,
  AbilityLoadingContext,
} from '@/app/context/ability-context';
import { TwoFactorGraceBanner } from '@/app/features/auth/components/two-factor-grace-banner';
import { TwoFactorLowBackupCodesBanner } from '@/app/features/auth/components/two-factor-low-backup-codes-banner';
import { EmbeddingSetupBanner } from '@/app/features/settings/data-residency/components/embedding-setup-banner';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { render, screen } from '@/tests/utils/render';

import {
  SessionLapseNotice,
  SessionLapseRecovery,
} from './session-lapse-recovery';

import '@/app/globals.css';
import '@/app/locals.css';

/** What the dashboard's nudges read: none of them shows until a case says. */
const nudges = vi.hoisted(() => ({
  twoFactor: undefined as unknown,
  embeddingConfigured: true,
}));
vi.mock('@/app/context/account-bootstrap-context', () => ({
  useTwoFactorStatus: () => nudges.twoFactor,
}));
vi.mock('@/app/features/settings/data-residency/hooks/queries', () => ({
  useOrgKnowledgeEmbedding: () => ({
    data: { configured: nudges.embeddingConfigured },
    isError: false,
  }),
}));
vi.mock('@/app/features/settings/providers/hooks/queries', () => ({
  useProviderCredentials: () => ({ data: [{ id: 'credential-1' }] }),
}));
// The nudges' links lead to settings; no router is needed to lay them out.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <a href="#settings" className={className}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--safe-top');
  nudges.twoFactor = undefined;
  nudges.embeddingConfigured = true;
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

/** A dashboard page in the shell: its alert stack, then the page under its
 * header, in a column as tall as the window. */
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

/** The notch of an installed iPhone app, as `env(safe-area-inset-top)`. */
const NOTCH = 47;

/** An admin, for whom every dashboard nudge may show. */
const ADMIN = defineAbilityFor('admin');

/** The phone shell as `$id.tsx` lays it out: the alert stack (the session
 * notice, then the dashboard's nudges), then the shell's header, or on a
 * thread page the spacer, then the page. */
function PhoneShell({
  recovery,
  threadPage,
}: {
  recovery: typeof PAUSED;
  threadPage: boolean;
}) {
  return (
    <SessionLapseRecovery recovery={recovery}>
      <AbilityContext.Provider value={ADMIN}>
        <AbilityLoadingContext.Provider value={false}>
          <div className="mobile-nav-shell flex h-full w-full flex-col overflow-hidden">
            <SessionLapseNotice />
            <TwoFactorGraceBanner organizationId="org-1" />
            <TwoFactorLowBackupCodesBanner organizationId="org-1" />
            <EmbeddingSetupBanner organizationId="org-1" />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
              {threadPage ? (
                <ShellNotchSpacer />
              ) : (
                <ShellMobileHeader>
                  <Row gap={2} className="min-h-12">
                    <h1>Products</h1>
                  </Row>
                </ShellMobileHeader>
              )}
              <main className="min-h-0 flex-1">
                <h2>Page</h2>
              </main>
            </div>
          </div>
        </AbilityLoadingContext.Provider>
      </AbilityContext.Provider>
    </SessionLapseRecovery>
  );
}

// The notice pads the notch itself, and the shell's header (or a thread
// page's spacer) padded it again right below it: a blank band as tall as
// the notch under the notice, in the lapsed state only.
describe('the notch of an installed app', () => {
  async function renderPhoneShell(
    recovery: typeof PAUSED,
    threadPage: boolean,
  ) {
    await page.viewport(375, 740);
    document.documentElement.style.setProperty('--safe-top', `${NOTCH}px`);
    const { container } = renderApp(
      <PhoneShell recovery={recovery} threadPage={threadPage} />,
    );
    // `hidden`: an open confirmation hides the page from the accessibility
    // tree, and the page is still what is measured.
    const main = screen.getByRole('main', { hidden: true });
    return {
      header: container.querySelector('header'),
      spacer: threadPage ? (main.previousElementSibling as HTMLElement) : null,
      page: main,
    };
  }

  it('is cleared once, by the notice, above the shell header', async () => {
    const { header } = await renderPhoneShell(PAUSED, false);
    if (header === null) throw new Error('no shell header');
    expect(noticeTitle().getBoundingClientRect().top).toBeGreaterThanOrEqual(
      NOTCH,
    );
    expect(getComputedStyle(header).paddingTop).toBe('0px');
    expect(header.getBoundingClientRect().top).toBe(
      notice().getBoundingClientRect().bottom,
    );
  });

  it('is cleared once, by the notice, above a thread page', async () => {
    const { spacer, page: main } = await renderPhoneShell(PAUSED, true);
    if (spacer === null) throw new Error('no notch spacer');
    expect(spacer.getBoundingClientRect().height).toBe(0);
    expect(main.getBoundingClientRect().top).toBe(
      notice().getBoundingClientRect().bottom,
    );
  });

  it('is cleared by the shell itself while signed in', async () => {
    const { header } = await renderPhoneShell(SIGNED_IN, false);
    if (header === null) throw new Error('no shell header');
    expect(screen.queryByRole('status', { hidden: true })).toBeNull();
    expect(getComputedStyle(header).paddingTop).toBe(`${NOTCH}px`);
    cleanup();
    const { spacer } = await renderPhoneShell(SIGNED_IN, true);
    expect(spacer?.getBoundingClientRect().height).toBe(NOTCH);
  });

  it('is still cleared once, by the unseen notice, while the confirmation is open', async () => {
    const { header } = await renderPhoneShell(ASKING, false);
    if (header === null) throw new Error('no shell header');
    const held = screen.getByRole('status', { hidden: true });
    expect(getComputedStyle(held).visibility).toBe('hidden');
    expect(getComputedStyle(header).paddingTop).toBe('0px');
    expect(header.getBoundingClientRect().top).toBe(
      held.getBoundingClientRect().bottom,
    );
  });

  /** A nudge's own top padding (`py-3`); standing first, it adds the notch. */
  const NUDGE_PAD = 12;
  /** The dashboard's nudges, each shown the way its own read says so. */
  const NUDGES = [
    {
      nudge: 'the two-factor grace banner',
      title: /^Two-factor authentication required in 3 days$/,
      show: () => {
        nudges.twoFactor = {
          authenticated: true,
          twoFactorEnabled: false,
          decision: 'grace',
          graceUntil: Date.now() + 2.5 * 24 * 60 * 60 * 1000,
          backupCodesRemaining: null,
        };
      },
    },
    {
      nudge: 'the low backup codes banner',
      title: /^Only 2 backup codes remaining$/,
      show: () => {
        nudges.twoFactor = {
          authenticated: true,
          twoFactorEnabled: true,
          decision: 'allowed',
          graceUntil: null,
          backupCodesRemaining: 2,
        };
      },
    },
    {
      nudge: 'the embedding setup banner',
      title: /^Knowledge search is off$/,
      show: () => {
        nudges.embeddingConfigured = false;
      },
    },
  ];

  // With no notice above it, a nudge stood first with its words under the
  // notch, and the shell's header still padded the notch below it: a blank
  // band as tall as the notch between the two.
  describe.each(NUDGES)('with $nudge and no notice', ({ title, show }) => {
    it('is cleared once, by the nudge, above the shell header', async () => {
      show();
      const { header } = await renderPhoneShell(SIGNED_IN, false);
      if (header === null) throw new Error('no shell header');
      const nudge = screen.getByRole('status');
      expect(
        screen.getByText(title).getBoundingClientRect().top,
      ).toBeGreaterThanOrEqual(NOTCH);
      expect(getComputedStyle(nudge).paddingTop).toBe(`${NUDGE_PAD + NOTCH}px`);
      expect(getComputedStyle(header).paddingTop).toBe('0px');
      expect(header.getBoundingClientRect().top).toBe(
        nudge.getBoundingClientRect().bottom,
      );
    });

    it('is cleared once, by the nudge, above a thread page', async () => {
      show();
      const { spacer, page: main } = await renderPhoneShell(SIGNED_IN, true);
      if (spacer === null) throw new Error('no notch spacer');
      expect(
        screen.getByText(title).getBoundingClientRect().top,
      ).toBeGreaterThanOrEqual(NOTCH);
      expect(spacer.getBoundingClientRect().height).toBe(0);
      expect(main.getBoundingClientRect().top).toBe(
        screen.getByRole('status').getBoundingClientRect().bottom,
      );
    });
  });

  it('is cleared once, by the first of two nudges', async () => {
    for (const { show } of NUDGES.slice(1)) show();
    const { header } = await renderPhoneShell(SIGNED_IN, false);
    if (header === null) throw new Error('no shell header');
    const [first, second, ...others] = screen.getAllByRole('status');
    expect(others).toEqual([]);
    expect(getComputedStyle(first).paddingTop).toBe(`${NUDGE_PAD + NOTCH}px`);
    expect(getComputedStyle(second).paddingTop).toBe(`${NUDGE_PAD}px`);
    expect(getComputedStyle(header).paddingTop).toBe('0px');
    expect(header.getBoundingClientRect().top).toBe(
      second.getBoundingClientRect().bottom,
    );
  });

  it('is cleared once, by the notice, above a nudge', async () => {
    NUDGES[0].show();
    const { header } = await renderPhoneShell(PAUSED, false);
    if (header === null) throw new Error('no shell header');
    const [standing, nudge, ...others] = screen.getAllByRole('status');
    expect(others).toEqual([]);
    expect(standing).toContainElement(noticeTitle());
    expect(noticeTitle().getBoundingClientRect().top).toBeGreaterThanOrEqual(
      NOTCH,
    );
    expect(getComputedStyle(nudge).paddingTop).toBe(`${NUDGE_PAD}px`);
    expect(getComputedStyle(header).paddingTop).toBe('0px');
    expect(header.getBoundingClientRect().top).toBe(
      nudge.getBoundingClientRect().bottom,
    );
  });
});

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

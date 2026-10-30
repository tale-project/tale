import '@testing-library/jest-dom/vitest';
import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@tale/ui/adaptive-header';
import { DirtyBlockerProvider } from '@tale/ui/editor';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { MobileBottomNav } from '@/app/components/layout/mobile-bottom-nav';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import { AutomationDetailShell } from './automation-detail-shell';
import { AutomationRunsTab } from './automation-runs-tab';

import '@/app/globals.css';

/**
 * The Runs tab laid out by a real browser, in the shell it opens in. jsdom
 * performs no layout, so only here can the page be seen scrolling where the
 * rows should: the tab is a collection screen, and like the Automations list
 * its rows scroll inside the table's own frame while the heading, Filter,
 * the column header row and the count footer stay where the reader left
 * them — under a wheel or a trackpad, by keyboard, on a phone — and a short
 * window lets the page scroll instead.
 */

const { history, loadMore } = vi.hoisted(() => ({
  history: {
    runs: [] as Record<string, unknown>[],
    status: 'Exhausted' as
      | 'LoadingFirstPage'
      | 'CanLoadMore'
      | 'LoadingMore'
      | 'Exhausted',
  },
  loadMore: vi.fn(),
}));

vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useAutomation: () => ({
    data: { version: 2, deployedVersion: 2 },
    isPending: false,
    isError: false,
    error: null,
  }),
  useAutomations: () => ({
    data: [{ name: 'pr-digest', projectIds: [], presentation: undefined }],
  }),
  useAutomationVersions: () => ({
    data: [
      {
        version: 2,
        message: 'Updated the summary',
        testsPassed: true,
        createdBy: 'user:user-me',
        createdAt: 1_700_000_100_000,
      },
    ],
  }),
  useAutomationRunsPage: () => ({
    results: history.runs,
    status: history.status,
    isLoading: history.status === 'LoadingFirstPage',
    loadMore,
    error: null,
    retry: vi.fn(),
    isRetrying: false,
    unavailable: false,
    errorCount: 0,
  }),
}));

vi.mock('@/app/hooks/use-ability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-ability')>()),
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));

vi.mock('@/app/features/projects/hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/features/projects/hooks/queries')
  >()),
  useProjects: () => ({ projects: [], isLoading: false }),
}));

// Who started each run: the member directory answers from here.
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: [], isLoading: false }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

vi.mock('@/app/hooks/use-navigation-items', () => ({
  isItemActive: (item: { href: string }, pathname: string) =>
    pathname === item.href || pathname.startsWith(`${item.href}/`),
  useNavigationItems: () => ({
    primary: [
      {
        label: 'Home',
        href: '/dashboard/org-test/home',
        to: '/dashboard/$id/home',
        params: { id: 'org-test' },
      },
    ],
    pinned: [],
  }),
}));
vi.mock(
  '@/app/components/branding/branding-provider',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/components/branding/branding-provider')
    >()),
    useBrandingContext: () => ({ accentColor: null }),
  }),
);

afterEach(() => {
  cleanup();
  history.runs = [];
  history.status = 'Exhausted';
  loadMore.mockReset();
});

/** `count` runs, newest first, each failed with words of its own, so a row
 * can be found by what it says. */
function runsOf(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `run-${index + 1}`,
    name: 'pr-digest',
    version: 2,
    status: 'failed',
    mode: 'mock',
    detail: `Run ${index + 1} stopped at fetch`,
    startedBy: 'user:user-me',
    startedAt: 1_789_363_168_936 - index * 60_000,
    finishedAt: 1_789_363_170_729 - index * 60_000,
  }));
}

/** The dashboard layout's frame (`routes/dashboard/$id.tsx`): a column as
 * tall as the window whose `main` hands the page its height, with the phone
 * header and the bottom tab bar below `md`. */
function DashboardFrame() {
  return (
    <DirtyBlockerProvider>
      <AdaptiveHeaderProvider>
        <div className="mobile-nav-shell flex h-dvh w-full flex-col overflow-hidden">
          <header className="border-border border-b px-4 md:hidden">
            <AdaptiveHeaderSlot />
          </header>
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
          <MobileBottomNav organizationId="org-test" />
        </div>
      </AdaptiveHeaderProvider>
    </DirtyBlockerProvider>
  );
}

/** The Runs tab as its route renders it, in the automation's chrome. */
function renderRunsTab(runs: Record<string, unknown>[]) {
  history.runs = runs;
  const rootRoute = createRootRoute({ component: DashboardFrame });
  const runsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dashboard/$id/automations/$automationSlug/runs',
    component: () => (
      <AutomationDetailShell
        organizationId="org-test"
        automationSlug="pr-digest"
      >
        <AutomationRunsTab
          organizationId="org-test"
          automationSlug="pr-digest"
        />
      </AutomationDetailShell>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([runsRoute]),
    history: createMemoryHistory({
      initialEntries: ['/dashboard/org-test/automations/pr-digest/runs'],
    }),
  });
  return render(<RouterProvider router={router} />);
}

const heading = () => screen.getByRole('heading', { level: 2, name: 'Runs' });

/** The table's one scrollport, once the tab has drawn its table. */
async function rowsScrollport() {
  await screen.findByRole('table', { name: 'Runs of this automation' });
  return screen.getByTestId('data-table-scrollport');
}

/** The page shell's scroller (`PageLayout`): what moves when the rows do not
 * scroll inside their table. */
function pageScroller() {
  const scroller = heading().closest('.mobile-nav-scroll');
  if (!(scroller instanceof HTMLElement)) throw new Error('no page scroller');
  return scroller;
}

const scrollsDown = (element: HTMLElement) =>
  element.scrollHeight > element.clientHeight + 1;

/** Every element with rows to scroll vertically: what a reader's wheel can
 * move. */
function verticalScrollers() {
  return [...document.querySelectorAll<HTMLElement>('*')].filter(
    (element) =>
      ['auto', 'scroll'].includes(getComputedStyle(element).overflowY) &&
      scrollsDown(element),
  );
}

/** A run's row, by the words its Result cell says. */
function rowOf(text: string) {
  const row = screen.getByText(text).closest('tr');
  if (row === null) throw new Error(`no row says ${text}`);
  return row;
}

/** What must hold its place while the rows scroll. */
function fixedChrome() {
  return {
    heading: heading(),
    filter: screen.getByRole('button', { name: /^Filter/ }),
    headerRow: screen.getByRole('columnheader', { name: 'Status' }),
    footer: screen.getByText('Showing all 40 runs'),
  };
}

function tops(elements: Record<string, HTMLElement>) {
  return Object.fromEntries(
    Object.entries(elements).map(([name, element]) => [
      name,
      element.getBoundingClientRect().top,
    ]),
  );
}

/** Whether all of `element` is drawn inside the scrollport, under its
 * pinned header row rather than behind it. */
function inView(element: HTMLElement, port: HTMLElement) {
  const box = element.getBoundingClientRect();
  const header = screen
    .getByRole('columnheader', { name: 'Status' })
    .getBoundingClientRect();
  const frame = port.getBoundingClientRect();
  return box.top >= header.bottom - 1 && box.bottom <= frame.bottom + 1;
}

/** Until the scrollport has stopped moving. A wheel can scroll by
 * animation, and a position read half way is not where the reader ends up. */
async function settledScroll(scroller: HTMLElement) {
  let still = 0;
  let last = scroller.scrollTop;
  for (let frame = 0; frame < 240 && still < 4; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    still = scroller.scrollTop === last ? still + 1 : 0;
    last = scroller.scrollTop;
  }
}

describe('the Runs tab in Chromium', () => {
  it('scrolls the rows inside the table under a wheel, the heading, Filter, the header row, the footer and Compare staying put', async () => {
    await page.viewport(1280, 800);
    renderRunsTab(runsOf(40));
    const port = await rowsScrollport();
    // One thing scrolls: the table's own scrollport, never the page.
    expect(verticalScrollers()).toEqual([port]);

    await userEvent.click(
      within(rowOf('Run 1 stopped at fetch')).getByRole('checkbox'),
    );
    await userEvent.click(
      within(rowOf('Run 2 stopped at fetch')).getByRole('checkbox'),
    );
    const chrome = {
      ...fixedChrome(),
      compare: screen.getByRole('button', { name: 'Compare' }),
    };
    const before = tops(chrome);

    await userEvent.wheel(screen.getByText('Run 3 stopped at fetch'), {
      delta: { y: 600 },
    });
    await expect.poll(() => port.scrollTop).toBeGreaterThan(0);
    await settledScroll(port);

    expect(tops(chrome)).toEqual(before);
    expect(pageScroller().scrollTop).toBe(0);
    expect(chrome.compare.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      window.innerHeight,
    );
    // Under the wheel the rows move: the first is gone above the pinned
    // header row, and the frame shows rows further down.
    expect(inView(rowOf('Run 1 stopped at fetch'), port)).toBe(false);
  });

  it('scrolls the rows by keyboard from a row, the header row pinned to the top of the frame', async () => {
    await page.viewport(1280, 800);
    renderRunsTab(runsOf(40));
    const port = await rowsScrollport();
    const headerRow = screen.getByRole('columnheader', { name: 'Status' });
    const pinned = headerRow.getBoundingClientRect().top;
    const last = rowOf('Run 40 stopped at fetch');
    expect(inView(last, port)).toBe(false);

    within(rowOf('Run 1 stopped at fetch')).getByRole('checkbox').focus();
    await userEvent.keyboard('{PageDown}');
    await expect.poll(() => port.scrollTop).toBeGreaterThan(0);
    await userEvent.keyboard('{End}');
    await expect.poll(() => inView(last, port)).toBe(true);
    expect(headerRow.getBoundingClientRect().top).toBe(pinned);
    await userEvent.keyboard('{Home}');
    await expect.poll(() => port.scrollTop).toBe(0);
    expect(pageScroller().scrollTop).toBe(0);
  });

  it('moves the rows inside the frame, not the page, when Tab reaches a run below the fold', async () => {
    await page.viewport(1280, 800);
    renderRunsTab(runsOf(40));
    const port = await rowsScrollport();
    const rows = within(port).getAllByRole('row').slice(1);
    const lastSeen = rows.findLast((row) => inView(row, port));
    if (lastSeen === undefined) throw new Error('no run in view');
    const next = rows[rows.indexOf(lastSeen) + 1];
    within(lastSeen)
      .getByRole('button', { name: /^More for the run of / })
      .focus();

    await userEvent.keyboard('{Tab}');

    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) throw new Error('nothing focused');
    expect(next).toContainElement(focused);
    expect(port.scrollTop).toBeGreaterThan(0);
    expect(focused.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      port.getBoundingClientRect().bottom,
    );
    expect(pageScroller().scrollTop).toBe(0);
  });

  it('keeps a phone at its width, the rows scrolling inside the frame above the tab bar', async () => {
    await page.viewport(390, 844);
    renderRunsTab(runsOf(40));
    const port = await rowsScrollport();

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
    // The columns keep their widths and scroll sideways inside the frame.
    expect(port.scrollWidth).toBeGreaterThan(port.clientWidth);
    expect(verticalScrollers()).toEqual([port]);
    const nav = screen
      .getByRole('navigation', { name: 'Primary navigation' })
      .getBoundingClientRect();
    expect(port.getBoundingClientRect().bottom).toBeLessThanOrEqual(nav.top);

    port.scrollTop = port.scrollHeight;
    const last = rowOf('Run 40 stopped at fetch');
    await expect.poll(() => inView(last, port)).toBe(true);
    expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(nav.top);
  });

  it('lets the page scroll on a short window, the frame growing with its rows', async () => {
    await page.viewport(640, 360);
    renderRunsTab(runsOf(40));
    const port = await rowsScrollport();

    expect(scrollsDown(port)).toBe(false);
    expect(scrollsDown(pageScroller())).toBe(true);
  });

  it('hugs a short history instead of stretching to the window', async () => {
    await page.viewport(1280, 800);
    renderRunsTab(runsOf(3));
    const port = await rowsScrollport();

    expect(verticalScrollers()).toEqual([]);
    const footer = screen.getByText('Showing all 3 runs');
    expect(port.contains(footer)).toBe(true);
    // The frame ends at its footer, well above the window's bottom edge it
    // would stretch to.
    expect(port.getBoundingClientRect().bottom).toBeLessThan(
      window.innerHeight - 200,
    );
  });

  it('asks for older runs as the rows reach their end, not before', async () => {
    await page.viewport(1280, 800);
    history.status = 'CanLoadMore';
    renderRunsTab(runsOf(40));
    const port = await rowsScrollport();
    // A load that must not come has no event to await: the pause gives the
    // sentinel's first report time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(loadMore).not.toHaveBeenCalled();

    port.scrollTop = port.scrollHeight;

    await vi.waitFor(() => expect(loadMore).toHaveBeenCalledWith(20));
    expect(pageScroller().scrollTop).toBe(0);
  });

  it('masks the first page inside the frame while it loads', async () => {
    await page.viewport(1280, 800);
    history.status = 'LoadingFirstPage';
    renderRunsTab([]);

    const loading = await screen.findByRole('status', {
      name: 'Loading content',
    });
    expect(screen.getByTestId('data-table-scrollport')).toContainElement(
      loading,
    );
    expect(verticalScrollers()).toEqual([]);
    expect(
      screen.queryByText('This automation has not run yet.'),
    ).not.toBeInTheDocument();
  });

  it('says when the automation has not run, with nothing to scroll', async () => {
    await page.viewport(1280, 800);
    renderRunsTab([]);

    expect(
      await screen.findByText('This automation has not run yet.'),
    ).toBeVisible();
    expect(verticalScrollers()).toEqual([]);
    expect(screen.getByTestId('data-table-scrollport')).toContainElement(
      screen.getByText('This automation has not run yet.'),
    );
  });
});

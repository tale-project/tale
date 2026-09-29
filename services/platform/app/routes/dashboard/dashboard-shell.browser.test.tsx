import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { DashboardShellFrame } from '@/app/components/layout/dashboard-shell-frame';
import { SessionLapseRecovery } from '@/app/components/session-lapse-recovery';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import { render, screen } from '@/tests/utils/render';

import { Route } from './$id';

import '@/app/globals.css';
import '@/app/locals.css';

/** What the shell reads: the page it is on, and what each nudge's read
 * says. None of the nudges shows until a case says so. */
const h = vi.hoisted(() => ({
  pathname: '/dashboard/org-1/documents',
  twoFactor: undefined as unknown,
  embeddingConfigured: true,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useParams: () => ({ id: 'org-1' }),
  }),
  Outlet: () => <h2>Page</h2>,
  // The nudges' links lead to settings; no router is needed to lay them out.
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
  useLocation: () => ({ pathname: h.pathname, search: {} }),
  useNavigate: () => () => Promise.resolve(),
  useBlocker: () => ({
    status: 'idle',
    proceed: () => undefined,
    reset: () => undefined,
  }),
}));

// An admin of org-1, signed in, whose membership has resolved.
const MEMBER_CONTEXT = {
  data: {
    status: 'ok',
    role: 'admin',
    userId: 'user-1',
    organizationId: 'org-1',
  },
  isLoading: false,
  isError: false,
  refetch: () => Promise.resolve(),
};
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => MEMBER_CONTEXT,
}));
vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ isLoading: false, isAuthenticated: true }),
  useSessionUser: () => ({ isLoading: false, isAuthenticated: true }),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: () => Promise.resolve({ data: null, error: null }),
    organization: { setActive: () => Promise.resolve() },
  },
}));
vi.mock('@/app/lib/backend/use-backend-hints', () => ({
  useBackendHints: () => undefined,
}));
vi.mock('@/app/features/auth/hooks/use-password-expiry-gate', () => ({
  usePasswordExpiryGate: () => undefined,
}));

// The shell's reading regions are out of scope: the notch rule is about the
// alert stack and the header above them.
vi.mock('@/app/components/layout/app-sidebar/app-sidebar', () => ({
  AppSidebar: () => null,
}));
vi.mock('@/app/components/layout/mobile-bottom-nav', () => ({
  MobileBottomNav: () => null,
}));
vi.mock('@/app/components/user-button', () => ({
  UserButton: () => <button type="button">Account</button>,
}));
vi.mock('@/app/features/changelog/components/changelog-toast-trigger', () => ({
  ChangelogToastTrigger: () => null,
}));
vi.mock('@/app/features/home/components/home-panel', () => ({
  HomePanel: () => null,
}));

// The real nudges, each shown the way its own read says so.
vi.mock('@/app/context/account-bootstrap-context', () => ({
  useTwoFactorStatus: () => h.twoFactor,
}));
vi.mock('@/app/features/settings/data-residency/hooks/queries', () => ({
  useOrgKnowledgeEmbedding: () => ({
    data: { configured: h.embeddingConfigured },
    isError: false,
  }),
}));
vi.mock('@/app/features/settings/providers/hooks/queries', () => ({
  useProviderCredentials: () => ({ data: [{ id: 'credential-1' }] }),
}));

const DashboardLayout = (Route as unknown as { component: () => ReactNode })
  .component;

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--safe-top');
  document.documentElement.classList.remove('boot-thread-page');
  h.pathname = '/dashboard/org-1/documents';
  h.twoFactor = undefined;
  h.embeddingConfigured = true;
});

/** The notch of an installed iPhone app, as `env(safe-area-inset-top)`. */
const NOTCH = 47;

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
type Recovery = typeof PAUSED;

/** A thread page: its own header sits at the top, with no shell header (the
 * default page, documents, keeps the shell's). */
const CHAT = '/dashboard/org-1/chat/thread-1';

/** Render as the app mounts: in `#root`, which the app's stylesheets size to
 * the window and clip. */
function renderApp(ui: ReactElement) {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  return render(ui, { container: root });
}

/** The dashboard shell as `$id.tsx` renders it, in the layout that hosts
 * its session notice. */
function renderShell(recovery: Recovery = SIGNED_IN) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(sessionQueryOptions.queryKey, {
    data: {
      user: { id: 'user-1' },
      session: { activeOrganizationId: 'org-1' },
    },
    error: null,
  });
  const shell = (at: Recovery) => (
    <QueryClientProvider client={queryClient}>
      <SessionLapseRecovery recovery={at}>
        <DashboardLayout />
      </SessionLapseRecovery>
    </QueryClientProvider>
  );
  const view = renderApp(shell(recovery));
  return { rerender: (at: Recovery = recovery) => view.rerender(shell(at)) };
}

async function onPhone(notch: number) {
  await page.viewport(375, 740);
  document.documentElement.style.setProperty('--safe-top', `${notch}px`);
}

const box = (element: Element) => element.getBoundingClientRect();
const paddingTop = (element: Element) => getComputedStyle(element).paddingTop;
const tint = (element: Element) => getComputedStyle(element).backgroundColor;

function notchStrip(): HTMLElement {
  const strip = document.querySelector<HTMLElement>('[data-shell-notch]');
  if (strip === null) throw new Error('no notch strip');
  return strip;
}
function shellHeader(): HTMLElement {
  const header = document.querySelector('header');
  if (header === null) throw new Error('no shell header');
  return header;
}
/** `hidden`: an open confirmation hides the page from the accessibility
 * tree, and the page is still what is measured. */
const mainRegion = () => screen.getByRole('main', { hidden: true });
const alerts = () => screen.queryAllByRole('status', { hidden: true });

/** A nudge's own top padding (`py-3`), the notice's (`py-2`). */
const NUDGE_PAD = 12;
const NOTICE_PAD = 8;

const NUDGES = [
  {
    nudge: 'the two-factor grace banner',
    title: /^Two-factor authentication required in 3 days$/,
    show: () => {
      h.twoFactor = {
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
      h.twoFactor = {
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
      h.embeddingConfigured = false;
    },
  },
];

// The notch pad moved between the header and whichever alert stood first,
// keyed on two conditions that only agreed while every child above the
// header was an alert; each alert type also padded it its own way.
describe('the notch of an installed app, in the real shell', () => {
  it('is cleared by one strip that heads the shell, above every alert', async () => {
    await onPhone(NOTCH);
    NUDGES[0].show();
    NUDGES[2].show();
    renderShell(PAUSED);

    const shell = document.querySelector('.mobile-nav-shell');
    const strip = notchStrip();
    expect(shell?.firstElementChild).toBe(strip);
    expect(strip).toHaveAttribute('aria-hidden', 'true');
    expect(box(strip).top).toBe(0);
    expect(box(strip).height).toBe(NOTCH);
    // The alerts stand right under it, in the shell, above its header.
    const [notice, grace, embedding, ...others] = alerts();
    expect(others).toEqual([]);
    expect(strip.nextElementSibling).toBe(notice);
    expect(notice.nextElementSibling).toBe(grace);
    expect(grace.nextElementSibling).toBe(embedding);
    expect(box(notice).top).toBe(NOTCH);
    expect(paddingTop(notice)).toBe(`${NOTICE_PAD}px`);
    expect(paddingTop(grace)).toBe(`${NUDGE_PAD}px`);
    expect(paddingTop(embedding)).toBe(`${NUDGE_PAD}px`);
    // The strip wears the tint of the alert right below it.
    expect(tint(strip)).toBe(tint(notice));
    expect(paddingTop(shellHeader())).toBe('0px');
    expect(box(shellHeader()).top).toBe(box(embedding).bottom);
  });

  it('is cleared by the strip above the shell header while no alert stands', async () => {
    await onPhone(NOTCH);
    renderShell();
    expect(alerts()).toEqual([]);
    const strip = notchStrip();
    expect(box(strip).height).toBe(NOTCH);
    expect(tint(strip)).toBe(tint(shellHeader()));
    expect(paddingTop(shellHeader())).toBe('0px');
    expect(box(shellHeader()).top).toBe(NOTCH);
  });

  it('is cleared by the strip above a thread page, which has no shell header', async () => {
    await onPhone(NOTCH);
    h.pathname = CHAT;
    renderShell();
    expect(document.querySelector('header')).toBeNull();
    expect(box(notchStrip()).height).toBe(NOTCH);
    expect(box(mainRegion()).top).toBe(NOTCH);
  });

  it('is cleared once above the notice, and the strip steps aside with it', async () => {
    await onPhone(NOTCH);
    const { rerender } = renderShell(PAUSED);
    const notice = screen.getByRole('status');
    expect(
      screen.getByText('Your session has ended').getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(NOTCH);
    expect(box(shellHeader()).top).toBe(box(notice).bottom);
    const standing = box(shellHeader()).top;

    // The open confirmation hides the notice but keeps its place; the
    // strip keeps its height and gives the tint back.
    rerender(ASKING);
    const held = screen.getByRole('status', { hidden: true });
    expect(getComputedStyle(held).visibility).toBe('hidden');
    expect(box(notchStrip()).height).toBe(NOTCH);
    expect(tint(notchStrip())).toBe(tint(shellHeader()));
    expect(box(shellHeader()).top).toBe(standing);
  });

  describe.each(NUDGES)('with $nudge and no notice', ({ title, show }) => {
    it('is cleared once, by the strip, above the shell header', async () => {
      await onPhone(NOTCH);
      show();
      renderShell();
      const nudge = screen.getByRole('status');
      expect(box(nudge).top).toBe(NOTCH);
      expect(
        screen.getByText(title).getBoundingClientRect().top,
      ).toBeGreaterThanOrEqual(NOTCH);
      expect(paddingTop(nudge)).toBe(`${NUDGE_PAD}px`);
      expect(tint(notchStrip())).toBe(tint(nudge));
      expect(paddingTop(shellHeader())).toBe('0px');
      expect(box(shellHeader()).top).toBe(box(nudge).bottom);
    });

    it('is cleared once, by the strip, above a thread page', async () => {
      await onPhone(NOTCH);
      h.pathname = CHAT;
      show();
      renderShell();
      const nudge = screen.getByRole('status');
      expect(box(nudge).top).toBe(NOTCH);
      expect(box(mainRegion()).top).toBe(box(nudge).bottom);
    });
  });

  it('is cleared once, by the strip, above two nudges', async () => {
    await onPhone(NOTCH);
    for (const { show } of NUDGES.slice(1)) show();
    renderShell();
    const [first, second, ...others] = screen.getAllByRole('status');
    expect(others).toEqual([]);
    expect(box(first).top).toBe(NOTCH);
    expect(paddingTop(first)).toBe(`${NUDGE_PAD}px`);
    expect(paddingTop(second)).toBe(`${NUDGE_PAD}px`);
    expect(box(shellHeader()).top).toBe(box(second).bottom);
  });

  // From `md` up the shell has no header; the first alert used to pad the
  // status bar of an installed iPad app there, and the strip does so now.
  it('stands from md up only above an alert', async () => {
    await page.viewport(1280, 800);
    document.documentElement.style.setProperty('--safe-top', `${NOTCH}px`);
    const { rerender } = renderShell();
    expect(box(notchStrip()).height).toBe(0);
    rerender(PAUSED);
    expect(box(notchStrip()).height).toBe(NOTCH);
    expect(box(screen.getByRole('status')).top).toBe(NOTCH);
  });
});

/** A few frames: the one that lays out a change, then time for the browser
 * to report what it shifted. */
function frames(count = 3): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) =>
      left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
    step(count);
  });
}

/** A Layout Instability API entry (Chromium). */
interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

/** Paint the shell with no nudge, let the embedding nudge arrive the way a
 * late read brings it in, and measure what moved. */
async function lateNudge(notch: number) {
  await onPhone(notch);
  const { rerender } = renderShell();
  // A web font that lands mid-measure would reflow text of its own.
  await document.fonts.ready;
  await frames();
  const header = shellHeader();
  const before = box(header);
  const shifts: LayoutShiftEntry[] = [];
  const observer = new PerformanceObserver((list) => {
    shifts.push(...(list.getEntries() as LayoutShiftEntry[]));
  });
  observer.observe({ type: 'layout-shift' });
  h.embeddingConfigured = false;
  rerender();
  await frames();
  shifts.push(...(observer.takeRecords() as LayoutShiftEntry[]));
  observer.disconnect();
  const after = box(header);
  const measured = {
    moved: after.top - before.top,
    grew: after.height - before.height,
    nudge: box(screen.getByRole('status')).height,
    score: shifts
      .filter((shift) => !shift.hadRecentInput)
      .reduce((sum, shift) => sum + shift.value, 0),
  };
  cleanup();
  h.embeddingConfigured = true;
  return measured;
}

// A nudge whose read settles after the shell has painted took the header's
// notch pad with it: the header's box moved by the nudge and the notch
// together (about 91 px instead of 44), and the page's layout-shift score
// grew with the notch.
describe('a nudge that arrives after the shell has painted', () => {
  it('moves the header by its own height, notch or none', async () => {
    const flat = await lateNudge(0);
    const notched = await lateNudge(NOTCH);
    expect(flat.moved).toBeGreaterThan(0);
    expect(notched.nudge).toBe(flat.nudge);
    expect(notched.moved).toBe(flat.moved);
    expect(notched.grew).toBe(0);
    // The shift is measured at all, and the notch adds nothing to it.
    expect(flat.score).toBeGreaterThan(0);
    expect(notched.score).toBeLessThanOrEqual(flat.score);
  });
});

// The boot frame is the first paint; the resolved shell must slot in under
// the same notch clearance without a reflow.
describe('the boot frame under the notch', () => {
  it('heads itself with the strip, where the shell puts its header', async () => {
    await onPhone(NOTCH);
    renderApp(<DashboardShellFrame />);
    const strip = notchStrip();
    expect(strip.parentElement?.firstElementChild).toBe(strip);
    const bar = strip.nextElementSibling;
    if (bar === null) throw new Error('no top bar stand-in');
    expect(box(strip).height).toBe(NOTCH);
    expect(paddingTop(bar)).toBe('0px');
    expect(box(bar).top).toBe(NOTCH);
    cleanup();

    renderShell();
    expect(box(shellHeader()).top).toBe(NOTCH);
  });

  it('keeps the clearance on a thread page, whose bar it hides', async () => {
    await onPhone(NOTCH);
    document.documentElement.classList.add('boot-thread-page');
    renderApp(<DashboardShellFrame />);
    expect(box(notchStrip()).height).toBe(NOTCH);
    expect(box(screen.getByRole('main')).top).toBe(NOTCH);
  });
});

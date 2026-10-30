import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  historyReplace: vi.fn(),
  search: { to: 'org-globex' } as { to: string; subpath?: string },
  getSession: vi.fn(),
  setActive: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useSearch: () => h.search,
  }),
  useNavigate: () => h.navigate,
  useRouter: () => ({ history: { replace: h.historyReplace } }),
  // The way back is a link that replaces this address; it reports where it
  // goes and whether it replaces.
  Link: ({
    to,
    params,
    replace,
    children,
  }: {
    to: string;
    params?: { id: string };
    replace?: boolean;
    children: ReactNode;
  }) => (
    <a
      href={to.replace('$id', params?.id ?? '')}
      data-replace={String(replace === true)}
    >
      {children}
    </a>
  ),
}));
// A key and the values it names, so a test can read which organization a
// message is about.
vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, values?: Record<string, unknown>) =>
      [`${ns}.${key}`, ...Object.values(values ?? {})].join(' '),
  }),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: h.getSession,
    signOut: h.signOut,
    organization: { setActive: h.setActive },
  },
}));

import { ORG_SWITCH_TIMEOUT_MS } from '@/app/lib/auth/set-active-organization';
import { i18n } from '@/lib/i18n/i18n';

import { replaceDashboardPath, Route } from './switching';

const SwitchingPage = (Route as unknown as { component: () => ReactNode })
  .component;

const acme = { organizationId: 'org-acme', role: 'owner', name: 'Acme' };
const globex = { organizationId: 'org-globex', role: 'member', name: 'Globex' };

let queryClient: QueryClient;
let fetch: MockInstance<typeof globalThis.fetch>;

function pathOf(input: Parameters<typeof globalThis.fetch>[0]): string {
  const url = input instanceof Request ? input.url : String(input);
  return new URL(url, 'http://tale.test').pathname;
}
/** The organizations the audit log was told the person switched to. */
const recordedSwitches = () =>
  fetch.mock.calls
    .map(([input]) => pathOf(input))
    .filter((path) => path.endsWith('/record-switch'));

const tryAgain = () =>
  screen.getByRole('button', { name: 'common.actions.tryAgain' });
const connectionLost = (): string =>
  i18n.t('errors.connectionLost', { ns: 'common' });

/** Wait until the switch went on into Globex, replacing this address. */
const enteredGlobex = () =>
  waitFor(() =>
    expect(h.navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id',
      params: { id: 'org-globex' },
      replace: true,
    }),
  );

function renderSwitching() {
  return render(<SwitchingPage />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  h.navigate.mockReset();
  h.historyReplace.mockReset();
  h.search = { to: 'org-globex' };
  // The session is still in Acme, where the person chose Globex.
  h.getSession.mockReset().mockResolvedValue({
    data: {
      user: { id: 'user-1' },
      session: { activeOrganizationId: 'org-acme' },
    },
    error: null,
  });
  h.setActive.mockReset().mockResolvedValue({ data: {}, error: null });
  h.signOut
    .mockReset()
    .mockResolvedValue({ data: { success: true }, error: null });
  fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = pathOf(input);
    if (path === '/api/app/organizations') {
      return Response.json({ organizations: [acme, globex] });
    }
    if (path === '/api/app/users/me') {
      return Response.json({ user: { _id: 'user-1', email: 'a@tale.test' } });
    }
    if (path.endsWith('/record-switch')) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request to ${path}`);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('organization switching history', () => {
  it('replaces subpath destinations instead of pushing them', () => {
    const replace = vi.fn();
    replaceDashboardPath({ replace }, '/dashboard/org-b/projects');
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith('/dashboard/org-b/projects');
  });
});

describe('a switch the server refuses', () => {
  // Better Auth answers a refusal instead of throwing it: the page recorded
  // the switch, went on into Globex, and Globex's own sync spun for good.
  it('stays, names the organization and records nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.setActive.mockResolvedValue({
      data: null,
      error: {
        status: 429,
        statusText: 'Too Many Requests',
        message: 'Too many requests. Please try again later.',
      },
    });
    renderSwitching();
    expect(
      await screen.findByText('navigation.orgSwitcher.switchFailed Globex'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Too many requests. Please try again later.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(h.setActive).toHaveBeenCalledWith({ organizationId: 'org-globex' });
    await waitFor(() => expect(recordedSwitches()).toEqual([]));
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.historyReplace).not.toHaveBeenCalled();
    // The ways on: Try again, and back to the organization the session is
    // still in, in place of this address; never signing out.
    expect(tryAgain()).toBeEnabled();
    const back = screen.getByRole('link', {
      name: 'navigation.orgSwitcher.backTo Acme',
    });
    expect(back).toHaveAttribute('href', '/dashboard/org-acme');
    expect(back).toHaveAttribute('data-replace', 'true');
    expect(
      screen.queryByRole('button', {
        name: 'auth.accountUnavailable.signInAgain',
      }),
    ).not.toBeInTheDocument();
  });

  it('says the connection was lost when the switch gets no answer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.setActive.mockRejectedValue(new TypeError('Failed to fetch'));
    renderSwitching();
    expect(
      await screen.findByText('navigation.orgSwitcher.switchFailed Globex'),
    ).toBeInTheDocument();
    expect(screen.getByText(connectionLost())).toBeInTheDocument();
    expect(recordedSwitches()).toEqual([]);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('switches on Try again, and records that switch once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.setActive.mockResolvedValueOnce({
      data: null,
      error: { status: 429, statusText: 'Too Many Requests' },
    });
    const user = userEvent.setup();
    renderSwitching();
    await screen.findByText('navigation.orgSwitcher.switchFailed Globex');

    await user.click(tryAgain());
    await enteredGlobex();
    expect(h.setActive).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(recordedSwitches()).toEqual([
        '/api/app/organizations/org-globex/record-switch',
      ]),
    );
  });

  it('carries the page on into the organization once a switch succeeds', async () => {
    h.search = { to: 'org-globex', subpath: 'settings/account' };
    renderSwitching();
    await waitFor(() =>
      expect(h.historyReplace).toHaveBeenCalledWith(
        '/dashboard/org-globex/settings/account',
      ),
    );
    expect(recordedSwitches()).toEqual([
      '/api/app/organizations/org-globex/record-switch',
    ]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // A link into an organization the person is not in, from a session with
  // none active: nothing to name, and Home is the way back.
  it('names neither organization it cannot find, and offers Home', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.search = { to: 'org-elsewhere' };
    h.getSession.mockResolvedValue({
      data: { user: { id: 'user-1' }, session: { activeOrganizationId: null } },
      error: null,
    });
    h.setActive.mockResolvedValue({
      data: null,
      error: {
        status: 403,
        statusText: 'Forbidden',
        code: 'USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION',
        message: 'You are not a member of this organization.',
      },
    });
    renderSwitching();
    expect(
      await screen.findByText('navigation.orgSwitcher.switchFailedUnnamed'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('You are not a member of this organization.'),
    ).toBeInTheDocument();
    const home = screen.getByRole('link', {
      name: 'common.notFound.backToDashboard',
    });
    expect(home).toHaveAttribute('href', '/dashboard');
    expect(home).toHaveAttribute('data-replace', 'true');
  });
});

describe('a switch that does not finish', () => {
  it('says so once the bound passes, and still goes on when it succeeds late', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let settle = (_value: unknown) => {};
    h.setActive.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    renderSwitching();
    expect(
      await screen.findByText('navigation.orgSwitcher.switchingTo Globex'),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORG_SWITCH_TIMEOUT_MS);
    });
    expect(
      screen.getByText('navigation.orgSwitcher.switchFailed Globex'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('navigation.orgSwitcher.switchTimedOut'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(recordedSwitches()).toEqual([]);

    settle({ data: {}, error: null });
    await enteredGlobex();
    await waitFor(() =>
      expect(recordedSwitches()).toEqual([
        '/api/app/organizations/org-globex/record-switch',
      ]),
    );
  });

  it('starts over on Try again, and the earlier attempt no longer reports', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail = (_reason: unknown) => {};
    h.setActive.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    renderSwitching();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ORG_SWITCH_TIMEOUT_MS);
    });
    await user.click(tryAgain());
    await enteredGlobex();

    // The first attempt gives up after the second one went on.
    fail(new TypeError('Failed to fetch'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(h.navigate).toHaveBeenCalledTimes(1);
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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
  getSession: vi.fn(),
  setActive: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  redirect: vi.fn(),
  useNavigate: () => h.navigate,
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
vi.mock('@/app/components/layout/dashboard-shell-frame', () => ({
  DashboardShellFrame: () => <div data-testid="shell-frame" />,
}));

import { i18n } from '@/lib/i18n/i18n';

import { Route } from './index';

const DashboardIndex = (Route as unknown as { component: () => ReactNode })
  .component;

const acme = { organizationId: 'org-acme', role: 'owner', name: 'Acme' };
const globex = { organizationId: 'org-globex', role: 'member', name: 'Globex' };
const connectionLost = (): string =>
  i18n.t('errors.connectionLost', { ns: 'common' });

let queryClient: QueryClient;
let fetch: MockInstance<typeof globalThis.fetch>;
let organizationsAnswer: () => Response | Promise<Response>;
let lastActiveOrganizationId: string | null;
let href: string;
const realLocation = window.location;

function pathOf(input: Parameters<typeof globalThis.fetch>[0]): string {
  const url = input instanceof Request ? input.url : String(input);
  return new URL(url, 'http://tale.test').pathname;
}
const organizationReads = () =>
  fetch.mock.calls.filter(
    ([input]) => pathOf(input) === '/api/app/organizations',
  ).length;

function renderIndex() {
  return render(<DashboardIndex />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

const tryAgain = () =>
  screen.getByRole('button', { name: 'common.actions.tryAgain' });

const entered = (organizationId: string) =>
  waitFor(() =>
    expect(h.navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id',
      params: { id: organizationId },
    }),
  );

beforeEach(() => {
  // The organization list keeps its own retry policy; only its pause between
  // attempts is cut short here.
  queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  h.navigate.mockReset();
  h.getSession.mockReset().mockResolvedValue({
    data: { user: { id: 'user-1' }, session: { activeOrganizationId: null } },
    error: null,
  });
  h.setActive.mockReset().mockResolvedValue({ data: {}, error: null });
  h.signOut
    .mockReset()
    .mockResolvedValue({ data: { success: true }, error: null });
  organizationsAnswer = () => Response.json({ organizations: [acme, globex] });
  lastActiveOrganizationId = null;
  fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = pathOf(input);
    if (path === '/api/app/organizations') return organizationsAnswer();
    if (path === '/api/app/users/last-active-org') {
      return Response.json({ organizationId: lastActiveOrganizationId });
    }
    if (path === '/api/app/users/me') {
      return Response.json({ user: { _id: 'user-1', email: 'a@tale.test' } });
    }
    if (path.endsWith('/record-switch')) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request to ${path}`);
  });
  href = '/dashboard';
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname: '/dashboard',
      search: '',
      hash: '',
      get href() {
        return href;
      },
      set href(value: string) {
        href = value;
      },
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
  });
});

describe('the dashboard entry', () => {
  it('shows the frame while it works out the organization, then opens it', async () => {
    renderIndex();
    expect(screen.getByTestId('shell-frame')).toBeInTheDocument();
    await entered('org-acme');
    expect(h.setActive).toHaveBeenCalledWith({ organizationId: 'org-acme' });
    expect(
      fetch.mock.calls.some(
        ([input]) =>
          pathOf(input) === '/api/app/organizations/org-acme/record-switch',
      ),
    ).toBe(true);
    expect(screen.getByTestId('shell-frame')).toBeInTheDocument();
  });

  it.each([
    ['the session holds', 'org-globex', null],
    ['the person last used', null, 'org-globex'],
  ] as const)(
    'opens the organization %s',
    async (_, sessionOrganizationId, lastActive) => {
      h.getSession.mockResolvedValue({
        data: {
          user: { id: 'user-1' },
          session: { activeOrganizationId: sessionOrganizationId },
        },
        error: null,
      });
      lastActiveOrganizationId = lastActive;
      renderIndex();
      await entered('org-globex');
    },
  );

  it('opens the organization wizard for a person with none', async () => {
    organizationsAnswer = () => Response.json({ organizations: [] });
    renderIndex();
    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith({
        to: '/dashboard/create-organization',
      }),
    );
    expect(h.setActive).not.toHaveBeenCalled();
  });

  // The session's own choice is a preference: a read of it that gets no
  // answer must not hold the entry, as an answer that refuses never did.
  it('opens the organization it would otherwise when the session cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.getSession.mockRejectedValue(new TypeError('Failed to fetch'));
    lastActiveOrganizationId = 'org-globex';
    renderIndex();
    await entered('org-globex');
    expect(warn).toHaveBeenCalled();
  });
});

describe('a failed organization list', () => {
  it.each([
    [
      'answers 503',
      () =>
        Response.json(
          { error: 'UPSTREAM_UNAVAILABLE', message: 'Upstream restarting' },
          { status: 503 },
        ),
      // A fault's own payload is not the person's to read: the title alone.
      (): string => '',
    ],
    [
      'get no answer',
      () => Promise.reject(new TypeError('Failed to fetch')),
      connectionLost,
    ],
  ] as const)(
    'is named, with Try again, once it and its retries %s',
    async (_, failure, detail) => {
      organizationsAnswer = failure;
      const user = userEvent.setup();
      renderIndex();
      expect(
        await screen.findByText('auth.dashboardEntry.organizationsFailed'),
      ).toBeInTheDocument();
      // The first read and the three retries of a fault.
      expect(organizationReads()).toBe(4);
      expect(screen.queryByTestId('shell-frame')).not.toBeInTheDocument();
      expect(screen.getByRole('alert').textContent).toBe(
        `auth.dashboardEntry.organizationsFailed${detail()}`,
      );
      expect(
        screen.getByRole('button', {
          name: 'auth.accountUnavailable.signInAgain',
        }),
      ).toBeEnabled();
      expect(h.setActive).not.toHaveBeenCalled();

      organizationsAnswer = () => Response.json({ organizations: [acme] });
      await user.click(tryAgain());
      await entered('org-acme');
      expect(
        screen.queryByText('auth.dashboardEntry.organizationsFailed'),
      ).not.toBeInTheDocument();
    },
  );

  it('is named with the words of a refusal, asked once, and Try again recovers', async () => {
    organizationsAnswer = () =>
      Response.json(
        {
          error: 'FORBIDDEN',
          message: 'This session may not list organizations.',
        },
        { status: 403 },
      );
    const user = userEvent.setup();
    renderIndex();
    expect(
      await screen.findByText('auth.dashboardEntry.organizationsFailed'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('This session may not list organizations.'),
    ).toBeInTheDocument();
    // A refusal is an answer: it is not asked again on its own.
    expect(organizationReads()).toBe(1);

    organizationsAnswer = () => Response.json({ organizations: [acme] });
    await user.click(tryAgain());
    await entered('org-acme');
  });

  it('keeps the message, with Try again busy, while it asks again', async () => {
    organizationsAnswer = () =>
      Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    const user = userEvent.setup();
    renderIndex();
    await screen.findByText('auth.dashboardEntry.organizationsFailed');
    let answer = (_response: Response) => {};
    organizationsAnswer = () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      });
    await user.click(tryAgain());
    await waitFor(() =>
      expect(tryAgain()).toHaveAttribute('aria-busy', 'true'),
    );
    // react-query restarts a read that never answered from `pending`, with
    // no error: the notice and the refusal's words hold all the same.
    expect(screen.getByRole('alert').textContent).toBe(
      'auth.dashboardEntry.organizationsFailedFORBIDDEN',
    );
    expect(screen.queryByTestId('shell-frame')).not.toBeInTheDocument();
    answer(Response.json({ organizations: [acme] }));
    await entered('org-acme');
  });

  it('offers to sign in again, ending the session first', async () => {
    organizationsAnswer = () =>
      Response.json({ error: 'FORBIDDEN' }, { status: 403 });
    const user = userEvent.setup();
    renderIndex();
    await user.click(
      await screen.findByRole('button', {
        name: 'auth.accountUnavailable.signInAgain',
      }),
    );
    await waitFor(() => expect(href).toBe('/log-in?redirectTo=%2Fdashboard'));
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('a failed entry into the organization', () => {
  it('names the organization, with Try again, when setting it active fails', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    h.setActive.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderIndex();
    expect(
      await screen.findByText('auth.dashboardEntry.openFailed Acme'),
    ).toBeInTheDocument();
    expect(screen.getByText(connectionLost())).toBeInTheDocument();
    expect(screen.queryByTestId('shell-frame')).not.toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();

    await user.click(tryAgain());
    await entered('org-acme');
    expect(h.setActive).toHaveBeenCalledTimes(2);
  });

  // Better Auth answers a refusal instead of throwing it: the entry used to
  // go on into an organization the session never switched to.
  it('stops on a refusal, says why, and Try again enters what the list now holds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.setActive.mockResolvedValueOnce({
      data: null,
      error: {
        status: 403,
        statusText: 'Forbidden',
        code: 'USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION',
        message: 'You are not a member of this organization.',
      },
    });
    const user = userEvent.setup();
    renderIndex();
    expect(
      await screen.findByText('auth.dashboardEntry.openFailed Acme'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('You are not a member of this organization.'),
    ).toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalled();

    // The membership ended meanwhile: asked again, the list no longer holds it.
    organizationsAnswer = () => Response.json({ organizations: [globex] });
    await user.click(tryAgain());
    await entered('org-globex');
    expect(h.setActive).toHaveBeenLastCalledWith({
      organizationId: 'org-globex',
    });
  });

  it('keeps the message, with Try again busy, while it enters again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.setActive.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderIndex();
    await screen.findByText('auth.dashboardEntry.openFailed Acme');
    let settle = (_value: unknown) => {};
    h.setActive.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    await user.click(tryAgain());
    await waitFor(() =>
      expect(tryAgain()).toHaveAttribute('aria-busy', 'true'),
    );
    expect(
      screen.getByText('auth.dashboardEntry.openFailed Acme'),
    ).toBeInTheDocument();
    settle({ data: {}, error: null });
    await entered('org-acme');
  });

  it('fails again with the message and Try again ready', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.setActive.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    renderIndex();
    await screen.findByText('auth.dashboardEntry.openFailed Acme');
    await user.click(tryAgain());
    await waitFor(() => expect(h.setActive).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(tryAgain()).toBeEnabled());
    expect(
      screen.getByText('auth.dashboardEntry.openFailed Acme'),
    ).toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

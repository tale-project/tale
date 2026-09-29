import { DirtyBlockerProvider } from '@tale/ui/editor/dirty-blocker-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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
  getSession: vi.fn(),
  signOut: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
  realSession: false,
  session: { isAuthenticated: true, isLoading: false },
  outlet: (): ReactNode => null,
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  redirect: vi.fn(),
  useNavigate: () => h.navigate,
  useBlocker: () => ({ status: 'idle' }),
  Outlet: () => h.outlet(),
}));
vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({ t: (key: string) => `${ns}.${key}` }),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: h.getSession,
    signOut: h.signOut,
    $store: { notify: vi.fn() },
  },
}));
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: h.toast,
}));
vi.mock('@/app/hooks/use-session-user', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/hooks/use-session-user')>();
  return {
    ...actual,
    useSessionUser: () => (h.realSession ? actual.useSessionUser() : h.session),
  };
});
vi.mock('@/app/hooks/use-session-idle-watchdog', () => ({
  useSessionIdleWatchdog: () => undefined,
}));
vi.mock('@/app/components/layout/dashboard-shell-frame', () => ({
  DashboardShellFrame: () => <div data-testid="shell-frame" />,
}));
vi.mock('@/app/context/account-bootstrap-context', () => ({
  useTwoFactorStatus: () => ({ authenticated: true, decision: 'allowed' }),
}));
vi.mock('@/app/context/account-bootstrap-provider', () => ({
  AccountBootstrapProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/app/features/products/hooks/use-product-image-upload', () => ({
  PRODUCT_IMAGE_ACCEPT: 'image/*',
  PRODUCT_IMAGE_MAX_BYTES: 5_000_000,
  useProductImageUpload: () => ({ uploadImage: vi.fn(), isUploading: false }),
}));
vi.mock('@/app/features/products/hooks/mutations', () => ({
  useCreateProduct: () => ({ mutate: vi.fn(), isPending: false }),
}));
// The wizard's name field stands in for its steps: it keeps what was typed
// for as long as the wizard stays mounted, and no longer.
vi.mock(
  '@/app/features/organization/components/onboarding/onboarding-wizard',
  () => ({
    OnboardingWizard: () => <input aria-label="Organization name" />,
  }),
);

import { ProductCreateDialog } from '@/app/features/products/components/product-create-dialog';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import { currentUserQuery } from '@/app/lib/backend/account';
import { backendApiErrorFromBody } from '@/app/lib/backend/api-client';
import {
  organizationCapabilitiesQuery,
  userOrganizationsQuery,
} from '@/app/lib/backend/org';
import { LAPSED_SESSION_ANSWER } from '@/tests/utils/lapsed-session';

import { Route } from './dashboard';
import { Route as CreateOrganizationRoute } from './dashboard/create-organization';

const realLocation = window.location;
let href: string;
let queryClient: QueryClient;
function QueryWrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
const Dashboard = (Route as unknown as { component: () => ReactNode })
  .component;
const lapse = () =>
  act(() => {
    backendApiErrorFromBody(
      LAPSED_SESSION_ANSWER.status,
      LAPSED_SESSION_ANSWER.body,
    );
  });
beforeEach(() => {
  h.realSession = false;
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 300_000, gcTime: Infinity },
    },
  });
  h.getSession.mockReset().mockResolvedValue({ data: null, error: null });
  h.navigate.mockReset();
  h.session = { isAuthenticated: true, isLoading: false };
  href = '/dashboard/org-1/products';
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname: href,
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
  h.outlet = () => (
    <DirtyBlockerProvider>
      <ProductCreateDialog isOpen onClose={vi.fn()} organizationId="org-1" />
    </DirtyBlockerProvider>
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
  });
});

describe('confirmed session lapse with an unregistered product draft', () => {
  it.each(['before', 'during'] as const)(
    'preserves input typed %s the recheck and asks before leaving',
    async (timing) => {
      let resolve = (_answer: { data: null; error: null }) => {};
      if (timing === 'during')
        h.getSession.mockReturnValueOnce(
          new Promise((done) => {
            resolve = done;
          }),
        );
      const user = userEvent.setup();
      render(<Dashboard />, { wrapper: QueryWrapper });
      const name = screen.getByLabelText('products.edit.labels.name', {
        exact: false,
      });
      const description = screen.getByLabelText(
        'products.edit.labels.description',
        { exact: false },
      );
      if (timing === 'during') lapse();
      await user.type(name, 'Unfinished product');
      await user.type(description, 'Copy this before signing in.');
      if (timing === 'before') lapse();
      else await act(async () => resolve({ data: null, error: null }));
      const stay = await screen.findByRole('button', {
        name: 'auth.sessionLapse.stayHere',
      });
      expect(href).toBe('/dashboard/org-1/products');
      await user.click(stay);
      await waitFor(() => expect(description).toHaveFocus());
      expect(name).toHaveValue('Unfinished product');
      expect(description).toHaveValue('Copy this before signing in.');
      lapse();
      lapse();
      await waitFor(() => expect(h.getSession).toHaveBeenCalledTimes(2));
      expect(
        screen.queryByRole('button', { name: 'auth.sessionLapse.stayHere' }),
      ).not.toBeInTheDocument();
      expect(href).toBe('/dashboard/org-1/products');
      const reopen = screen.getByRole('button', {
        name: 'auth.sessionLapse.signIn',
        hidden: true,
      });
      fireEvent.click(reopen);
      await user.click(
        await screen.findByRole('button', { name: 'auth.sessionLapse.signIn' }),
      );
      await waitFor(() =>
        expect(href).toBe(
          '/log-in?redirectTo=%2Fdashboard%2Forg-1%2Fproducts&reason=session-ended',
        ),
      );
    },
  );
  it('keeps the mounted draft when the dashboard probe also becomes unauthenticated', async () => {
    const view = render(<Dashboard />, { wrapper: QueryWrapper });
    const name = screen.getByLabelText('products.edit.labels.name', {
      exact: false,
    });
    fireEvent.change(name, { target: { value: 'Keep this draft' } });
    h.session = { isAuthenticated: false, isLoading: false };
    view.rerender(<Dashboard />);
    await screen.findByRole('button', { name: 'auth.sessionLapse.stayHere' });
    expect(name).toBeInTheDocument();
    expect(name).toHaveValue('Keep this draft');
    expect(href).toBe('/dashboard/org-1/products');
  });

  it('refreshes the signed-out user cache when another tab restores the session', async () => {
    h.realSession = true;
    const user = { userId: 'restored-user', name: 'Synthetic member' };
    queryClient.setQueryData(currentUserQuery().queryKey, user);
    queryClient.setQueryData(sessionQueryOptions.queryKey, {
      data: { user: { id: user.userId } },
      error: null,
    });
    render(<Dashboard />, { wrapper: QueryWrapper });
    const name = screen.getByLabelText('products.edit.labels.name', {
      exact: false,
    });
    fireEvent.change(name, { target: { value: 'Keep through recovery' } });
    act(() => {
      queryClient.setQueryData(currentUserQuery().queryKey, null);
    });
    const signIn = await screen.findByRole('button', {
      name: 'auth.sessionLapse.signIn',
    });
    expect(queryClient.getQueryData(currentUserQuery().queryKey)).toBeNull();
    h.getSession.mockResolvedValue({
      data: { user: { id: user.userId } },
      error: null,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ user }));
    fireEvent.click(signIn);
    await waitFor(() =>
      expect(queryClient.getQueryData(currentUserQuery().queryKey)).toEqual(
        user,
      ),
    );
    expect(
      screen.queryByRole('button', { name: 'auth.sessionLapse.stayHere' }),
    ).not.toBeInTheDocument();
    expect(name).toHaveValue('Keep through recovery');
    expect(href).toBe('/dashboard/org-1/products');
  });

  it('refreshes a cached signed-out probe on cold entry when the session is already live', async () => {
    h.realSession = true;
    const user = { userId: 'restored-user', name: 'Synthetic member' };
    queryClient.setQueryData(currentUserQuery().queryKey, null);
    queryClient.setQueryData(sessionQueryOptions.queryKey, {
      data: { user: { id: user.userId } },
      error: null,
    });
    h.getSession.mockResolvedValue({
      data: { user: { id: user.userId } },
      error: null,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ user }));
    render(<Dashboard />, { wrapper: QueryWrapper });
    await waitFor(() =>
      expect(queryClient.getQueryData(currentUserQuery().queryKey)).toEqual(
        user,
      ),
    );
    expect(
      screen.getByLabelText('products.edit.labels.name', { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'auth.sessionLapse.stayHere' }),
    ).not.toBeInTheDocument();
    expect(href).toBe('/dashboard/org-1/products');
  });

  it('refreshes a mounted signed-out probe when the first recheck already finds a live session', async () => {
    h.realSession = true;
    const user = { userId: 'restored-user', name: 'Synthetic member' };
    queryClient.setQueryData(currentUserQuery().queryKey, user);
    queryClient.setQueryData(sessionQueryOptions.queryKey, {
      data: { user: { id: user.userId } },
      error: null,
    });
    h.getSession.mockResolvedValue({
      data: { user: { id: user.userId } },
      error: null,
    });
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json({ user }));
    render(<Dashboard />, { wrapper: QueryWrapper });
    const name = screen.getByLabelText('products.edit.labels.name', {
      exact: false,
    });
    fireEvent.change(name, { target: { value: 'Keep without a prompt' } });
    act(() => {
      queryClient.setQueryData(currentUserQuery().queryKey, null);
    });
    await waitFor(() =>
      expect(queryClient.getQueryData(currentUserQuery().queryKey)).toEqual(
        user,
      ),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: 'auth.sessionLapse.stayHere' }),
    ).not.toBeInTheDocument();
    expect(name).toHaveValue('Keep without a prompt');
    expect(href).toBe('/dashboard/org-1/products');
  });

  it.each(['null', '401'] as const)(
    'does not loop when a live session refresh still gets %s from the user probe',
    async (answer) => {
      h.realSession = true;
      const user = { userId: 'restored-user', name: 'Synthetic member' };
      queryClient.setQueryData(currentUserQuery().queryKey, user);
      queryClient.setQueryData(sessionQueryOptions.queryKey, {
        data: { user: { id: user.userId } },
        error: null,
      });
      h.getSession.mockResolvedValue({
        data: { user: { id: user.userId } },
        error: null,
      });
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () =>
          answer === 'null'
            ? Response.json({ user: null })
            : Response.json(LAPSED_SESSION_ANSWER.body, {
                status: LAPSED_SESSION_ANSWER.status,
              }),
        );
      render(<Dashboard />, { wrapper: QueryWrapper });
      const name = screen.getByLabelText('products.edit.labels.name', {
        exact: false,
      });
      fireEvent.change(name, {
        target: { value: 'Keep without a request loop' },
      });
      act(() => {
        queryClient.setQueryData(currentUserQuery().queryKey, null);
      });
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      // Include another refusal after the refresh has settled. Neither that
      // answer nor the refresh's own 401 may trigger another invalidation.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
      lapse();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(name).toHaveValue('Keep without a request loop');
      expect(href).toBe('/dashboard/org-1/products');
    },
  );
});

const CreateOrganization = (
  CreateOrganizationRoute as unknown as { component: () => ReactNode }
).component;

// The create-organization page ran a signed-out redirect of its own under the
// layout that owns a lapse: once the probe lost its user, it unmounted the
// wizard, and the name typed into it, and left for /log-in with neither the
// page to come back to nor the Sign in / Stay here choice.
describe('a session that ends on the create-organization page', () => {
  const member = { userId: 'wizard-user', name: 'Synthetic member' };
  beforeEach(() => {
    h.realSession = true;
    href = '/dashboard/create-organization';
    queryClient.setQueryData(sessionQueryOptions.queryKey, {
      data: { user: { id: member.userId } },
      error: null,
    });
    queryClient.setQueryData(userOrganizationsQuery().queryKey, []);
    queryClient.setQueryData(organizationCapabilitiesQuery().queryKey, {
      canCreate: true,
    });
    h.outlet = () => (
      <div data-testid="page">
        <CreateOrganization />
      </div>
    );
  });

  it("keeps the wizard and its typed name behind the layout's Stay here", async () => {
    queryClient.setQueryData(currentUserQuery().queryKey, member);
    const user = userEvent.setup();
    render(<Dashboard />, { wrapper: QueryWrapper });
    const name = screen.getByLabelText('Organization name');
    await user.type(name, 'Acme Research');
    act(() => {
      queryClient.setQueryData(currentUserQuery().queryKey, null);
    });
    await user.click(
      await screen.findByRole('button', { name: 'auth.sessionLapse.stayHere' }),
    );
    expect(name).toBeInTheDocument();
    expect(name).toHaveValue('Acme Research');
    expect(h.navigate).not.toHaveBeenCalled();
    expect(href).toBe('/dashboard/create-organization');
  });

  // A session that ends here is mostly met by a re-read, once the stale
  // window has passed (a reconnect re-reads what is stale). Its refusal keeps
  // the last answer, and the wizard must stay behind the layout's Stay here
  // rather than give way to "the page could not load".
  it('keeps the wizard when a re-read of its capabilities meets the lapse', async () => {
    queryClient.setQueryData(currentUserQuery().queryKey, member);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json(LAPSED_SESSION_ANSWER.body, {
        status: LAPSED_SESSION_ANSWER.status,
      }),
    );
    const user = userEvent.setup();
    render(<Dashboard />, { wrapper: QueryWrapper });
    const name = screen.getByLabelText('Organization name');
    await user.type(name, 'Acme Research');
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: organizationCapabilitiesQuery().queryKey,
      });
    });
    expect(
      queryClient.getQueryState(organizationCapabilitiesQuery().queryKey)
        ?.status,
    ).toBe('error');
    await user.click(
      await screen.findByRole('button', { name: 'auth.sessionLapse.stayHere' }),
    );
    expect(name).toBeInTheDocument();
    expect(name).toHaveValue('Acme Research');
    expect(
      screen.queryByText('common.errors.errorLoadingPage'),
    ).not.toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalled();
    expect(href).toBe('/dashboard/create-organization');
  });

  // The layout mounts the page as soon as Better Auth confirms the session,
  // while the probe it refreshes still reads signed out; the capabilities read
  // waits for that probe, and the page must not take its silence for a no.
  it('holds its frame, never a refusal, while the probe catches up', async () => {
    queryClient.setQueryData(currentUserQuery().queryKey, null);
    queryClient.removeQueries({
      queryKey: organizationCapabilitiesQuery().queryKey,
    });
    h.getSession.mockResolvedValue({
      data: { user: { id: member.userId } },
      error: null,
    });
    let answerProbe = (_answer: Response) => {};
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.endsWith('/users/me')) {
          return new Promise<Response>((resolve) => {
            answerProbe = resolve;
          });
        }
        if (url.endsWith('/organizations/capabilities')) {
          return Response.json({ canCreate: true });
        }
        return Response.json({ organizations: [] });
      });
    render(<Dashboard />, { wrapper: QueryWrapper });
    // The layout has mounted the page; the probe has not answered yet.
    const page = await screen.findByTestId('page');
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/users\/me$/),
        expect.anything(),
      ),
    );
    expect(within(page).getByTestId('shell-frame')).toBeInTheDocument();
    expect(
      within(page).queryByText('onboarding.workspace.creationForbidden'),
    ).not.toBeInTheDocument();
    expect(
      within(page).queryByLabelText('Organization name'),
    ).not.toBeInTheDocument();

    await act(async () => answerProbe(Response.json({ user: member })));
    expect(
      await within(page).findByLabelText('Organization name'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('onboarding.workspace.creationForbidden'),
    ).not.toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalled();
    expect(href).toBe('/dashboard/create-organization');
  });
});

// Better Auth calls the session live while the backend's `/users/me` names
// nobody. The layout reloads once; after that it mounted the page anyway, and
// the create-organization page held its frame for good (its capabilities read
// waits on that user): no word, no retry, no way to sign in.
describe('a live session the backend has no user for, once the reload is spent', () => {
  // The layout's one-shot reload guard (`CONVEX_AUTH_RELOAD_GUARD`).
  const RELOAD_GUARD = 'convex-auth-recovery-reloaded';
  const member = { userId: 'wizard-user', name: 'Synthetic member' };
  let probe: () => Response;
  let reload: ReturnType<typeof vi.fn>;
  let fetch: MockInstance<typeof globalThis.fetch>;
  const probeCalls = () =>
    fetch.mock.calls.filter(([input]) =>
      (input instanceof Request ? input.url : String(input)).endsWith(
        '/users/me',
      ),
    ).length;
  beforeEach(() => {
    h.realSession = true;
    href = '/dashboard/create-organization';
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        pathname: href,
        search: '',
        hash: '',
        get href() {
          return href;
        },
        set href(value: string) {
          href = value;
        },
        reload,
      },
    });
    sessionStorage.setItem(RELOAD_GUARD, '1');
    h.getSession.mockResolvedValue({
      data: { user: { id: member.userId } },
      error: null,
    });
    h.signOut
      .mockReset()
      .mockResolvedValue({ data: { success: true }, error: null });
    h.toast.mockReset();
    probe = () => Response.json({ user: null });
    fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/users/me')) return probe();
      if (url.endsWith('/organizations/capabilities')) {
        return Response.json({ canCreate: true });
      }
      return Response.json({ organizations: [] });
    });
    h.outlet = () => (
      <div data-testid="page">
        <CreateOrganization />
      </div>
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.removeItem(RELOAD_GUARD);
  });

  it.each(['null', '401'] as const)(
    'says so, with a way on, when the probe answers %s',
    async (answer) => {
      if (answer === '401') {
        probe = () =>
          Response.json(LAPSED_SESSION_ANSWER.body, {
            status: LAPSED_SESSION_ANSWER.status,
          });
      }
      render(<Dashboard />, { wrapper: QueryWrapper });
      expect(
        await screen.findByText('auth.accountUnavailable.description'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'common.actions.tryAgain' }),
      ).toBeEnabled();
      expect(
        screen.getByRole('button', {
          name: 'auth.accountUnavailable.signInAgain',
        }),
      ).toBeEnabled();
      expect(screen.queryByTestId('page')).not.toBeInTheDocument();
      expect(screen.queryByTestId('shell-frame')).not.toBeInTheDocument();
      expect(reload).not.toHaveBeenCalled();
      expect(href).toBe('/dashboard/create-organization');
    },
  );

  it('opens the page once Try again finds the user', async () => {
    const user = userEvent.setup();
    render(<Dashboard />, { wrapper: QueryWrapper });
    const retry = await screen.findByRole('button', {
      name: 'common.actions.tryAgain',
    });
    probe = () => Response.json({ user: member });
    await user.click(retry);
    expect(
      await screen.findByLabelText('Organization name'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('auth.accountUnavailable.description'),
    ).not.toBeInTheDocument();
    // Signed in for real: the reload is armed again for a later stall.
    expect(sessionStorage.getItem(RELOAD_GUARD)).toBeNull();
  });

  // The sign-in page sends a live session straight back to the dashboard,
  // which would land here again: the session ends first.
  it('ends the session before it leaves for sign-in', async () => {
    const user = userEvent.setup();
    render(<Dashboard />, { wrapper: QueryWrapper });
    await user.click(
      await screen.findByRole('button', {
        name: 'auth.accountUnavailable.signInAgain',
      }),
    );
    await waitFor(() =>
      expect(href).toBe(
        '/log-in?redirectTo=%2Fdashboard%2Fcreate-organization',
      ),
    );
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it('stays, and says so, when the session cannot be ended', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.signOut.mockResolvedValue({
      data: null,
      error: { message: 'Sign-out refused' },
    });
    const user = userEvent.setup();
    render(<Dashboard />, { wrapper: QueryWrapper });
    const signInAgain = await screen.findByRole('button', {
      name: 'auth.accountUnavailable.signInAgain',
    });
    await user.click(signInAgain);
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith({
        title: 'auth.userButton.toast.signOutFailed',
        variant: 'destructive',
      }),
    );
    expect(href).toBe('/dashboard/create-organization');
    expect(signInAgain).toBeEnabled();
  });

  // A session an authenticating proxy asserted is the proxy's to end: the
  // account menu offers no sign-out for it, and a sign-out would be signed
  // straight back in.
  it('offers a proxied session Try again alone', async () => {
    const proxied = {
      data: {
        user: { id: member.userId },
        session: { trustedOrganizationId: 'org-1' },
      },
      error: null,
    };
    queryClient.setQueryData(sessionQueryOptions.queryKey, proxied);
    h.getSession.mockResolvedValue(proxied);
    render(<Dashboard />, { wrapper: QueryWrapper });
    expect(
      await screen.findByRole('button', { name: 'common.actions.tryAgain' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'auth.accountUnavailable.signInAgain',
      }),
    ).not.toBeInTheDocument();
  });

  // A probe that never held a user (a 401) goes back to loading on every
  // refetch. Keyed on that, the layout swapped the page for its frame and
  // back, each remount refetched the probe, and every refetch cancelled the
  // one reload: hundreds of requests a second behind a frame that never left.
  it('reloads once, with no request loop, when the probe answers 401', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.removeItem(RELOAD_GUARD);
    probe = () =>
      Response.json(LAPSED_SESSION_ANSWER.body, {
        status: LAPSED_SESSION_ANSWER.status,
      });
    render(<Dashboard />, { wrapper: QueryWrapper });
    expect(await screen.findByTestId('page')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RELOAD_GUARD)).toBe('1');
    // The probe's own read, the layout's refresh, the page's read on mount.
    expect(probeCalls()).toBeLessThanOrEqual(3);
    expect(screen.getByTestId('page')).toBeInTheDocument();
  });

  // The first stall still belongs to the one reload, which may well cure
  // it. An absence check: it can miss a regression, never flake red.
  it('leaves a stall to the reload while the reload is unspent', async () => {
    sessionStorage.removeItem(RELOAD_GUARD);
    render(<Dashboard />, { wrapper: QueryWrapper });
    expect(await screen.findByTestId('page')).toBeInTheDocument();
    // The probe's own read, then the layout's refresh of it.
    await waitFor(() => expect(probeCalls()).toBe(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(
      screen.queryByText('auth.accountUnavailable.description'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('page')).toBeInTheDocument();
  });
});

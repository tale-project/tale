import { DirtyBlockerProvider } from '@tale/ui/editor/dirty-blocker-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  realSession: false,
  session: { isAuthenticated: true, isLoading: false },
  outlet: (): ReactNode => null,
}));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
  redirect: vi.fn(),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ status: 'idle' }),
  Outlet: () => h.outlet(),
}));
vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({ t: (key: string) => `${ns}.${key}` }),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { getSession: h.getSession, $store: { notify: vi.fn() } },
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
  DashboardShellFrame: () => null,
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

import { ProductCreateDialog } from '@/app/features/products/components/product-create-dialog';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import { currentUserQuery } from '@/app/lib/backend/account';
import { backendApiErrorFromBody } from '@/app/lib/backend/api-client';
import { LAPSED_SESSION_ANSWER } from '@/tests/utils/lapsed-session';

import { Route } from './dashboard';

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

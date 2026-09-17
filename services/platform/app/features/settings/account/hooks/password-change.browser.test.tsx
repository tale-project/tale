import '@testing-library/jest-dom/vitest';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useNavigate,
} from '@tanstack/react-router';
import { afterEach, expect, it, vi } from 'vitest';

import { AccountBootstrapProvider } from '@/app/context/account-bootstrap-provider';
import { usePasswordExpiryGate } from '@/app/features/auth/hooks/use-password-expiry-gate';
import { passwordExpiryQuery } from '@/app/lib/backend/account';
import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { useUpdatePassword } from './mutations';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.__ENV__;
});

function DashboardGate() {
  usePasswordExpiryGate('synthetic-org');
  return <h1>Dashboard</h1>;
}

function RecoveryPage() {
  // The forced route and dashboard read this same user-scoped cache entry.
  const expiry = useQuery(passwordExpiryQuery());
  const password = useUpdatePassword();
  const navigate = useNavigate();
  return (
    <>
      <h1>Change password</h1>
      <button
        type="button"
        disabled={!expiry.data || password.isPending}
        onClick={async () => {
          await password.mutateAsync({
            newPassword: 'Synthetic-chromium-fixture!2',
            trigger: 'forced',
          });
          await navigate({
            to: '/dashboard/$id',
            params: { id: 'synthetic-org' },
          });
        }}
      >
        Save password
      </button>
    </>
  );
}

it('refreshes password expiry before a successful forced change returns to the dashboard', async () => {
  window.__ENV__ = { BASE_PATH: '' };
  let expired = true;
  let expiryReads = 0;
  let changes = 0;
  let releaseRefresh: () => void = () => {};
  const refreshAllowed = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    });
  const nativeFetch = window.fetch.bind(window);
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const path =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.href;
    if (path === '/api/app/users/password-expiry') {
      expiryReads += 1;
      if (!expired) await refreshAllowed;
      return json({ hasCredential: true, expired });
    }
    if (path.startsWith('/api/app/users/update-password')) {
      changes += 1;
      expired = false;
      return json({ ok: true });
    }
    if (path === '/api/app/two-factor/status') {
      return json({ enabled: false, hasPasskey: false });
    }
    return nativeFetch(input, init);
  });
  const root = createRootRoute({ component: Outlet });
  const forced = createRoute({
    getParentRoute: () => root,
    path: '/forced-change-password/$id',
    component: RecoveryPage,
  });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/$id',
    component: () => (
      <AccountBootstrapProvider>
        <DashboardGate />
      </AccountBootstrapProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([forced, dashboard]),
    history: createMemoryHistory({
      initialEntries: ['/forced-change-password/synthetic-org'],
    }),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: false } },
  });
  const { user } = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save password' })).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  await waitFor(() => expect(expiryReads).toBe(2));
  expect(router.state.location.pathname).toBe(
    '/forced-change-password/synthetic-org',
  );
  expect(screen.getByRole('button', { name: 'Save password' })).toBeDisabled();
  releaseRefresh();
  await screen.findByRole('heading', { name: 'Dashboard' });
  expect(client.getQueryData(passwordExpiryQuery().queryKey)).toMatchObject({
    expired: false,
  });
  expect(router.state.location.pathname).toBe('/dashboard/synthetic-org');
  expect(changes).toBe(1);
  client.clear();
});

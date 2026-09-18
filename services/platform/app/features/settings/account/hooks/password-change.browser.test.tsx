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

/**
 * The forced-change wall and the dashboard gate share ONE cached expiry
 * entry, and the page navigates the moment the change resolves — so a cache
 * still holding `expired: true` bounces the user straight back onto the wall
 * they just cleared, with the password already changed and only a manual
 * reload to get out. `answers` decides what the write hands back.
 */
function mountForcedChange(answers: {
  /** `false` = a backend that predates the status on the write's answer. */
  statusOnWrite: boolean;
  /** `true` = every expiry RE-read after the change fails (flaky gateway). */
  breakRereadAfterChange: boolean;
}) {
  window.__ENV__ = { BASE_PATH: '' };
  const counts = { expiryReads: 0, expiryReadsAfterChange: 0, changes: 0 };
  let expired = true;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
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
      counts.expiryReads += 1;
      if (counts.changes > 0) {
        counts.expiryReadsAfterChange += 1;
        if (answers.breakRereadAfterChange) {
          return json({ error: 'flaky gateway' }, 503);
        }
      }
      return json({ hasCredential: true, expired });
    }
    if (path.startsWith('/api/app/users/update-password')) {
      counts.changes += 1;
      expired = false;
      return json({
        ok: true,
        ...(answers.statusOnWrite
          ? { passwordExpiry: { hasCredential: true, expired: false } }
          : {}),
      });
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
  return { client, counts, router, user };
}

it('publishes the status the change answered, without re-reading it', async () => {
  const { client, counts, router, user } = mountForcedChange({
    statusOnWrite: true,
    breakRereadAfterChange: false,
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save password' })).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
  expect(router.state.location.pathname).toBe('/dashboard/synthetic-org');
  expect(client.getQueryData(passwordExpiryQuery().queryKey)).toMatchObject({
    expired: false,
  });
  // The write is the only round-trip the landing depends on.
  expect(counts.expiryReadsAfterChange).toBe(0);
  expect(counts.changes).toBe(1);
  client.clear();
});

it('still lands on the dashboard when every expiry re-read fails', async () => {
  const { client, router, user } = mountForcedChange({
    statusOnWrite: true,
    breakRereadAfterChange: true,
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save password' })).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
  expect(router.state.location.pathname).toBe('/dashboard/synthetic-org');
  client.clear();
});

it('falls back to re-reading when the write answers no status (mid-roll)', async () => {
  const { client, counts, router, user } = mountForcedChange({
    statusOnWrite: false,
    breakRereadAfterChange: false,
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save password' })).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
  expect(router.state.location.pathname).toBe('/dashboard/synthetic-org');
  expect(counts.expiryReadsAfterChange).toBe(1);
  expect(client.getQueryData(passwordExpiryQuery().queryKey)).toMatchObject({
    expired: false,
  });
  client.clear();
});

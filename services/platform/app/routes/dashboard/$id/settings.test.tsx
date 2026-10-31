import { AdaptiveHeaderProvider } from '@tale/ui/adaptive-header';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { describe, expect, it, vi } from 'vitest';

import { enMessages } from '@/tests/utils/messages';
import { act, render, screen, waitFor } from '@/tests/utils/render';

import { Route } from './settings';

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));

vi.mock(
  '@/app/features/settings/model-endpoints/hooks/use-api-settings-access',
  () => ({
    useApiSettingsAccess: () => ({
      developer: true,
      apiKeys: true,
      modelApi: true,
      agents: true,
      undecided: { apiKeys: false, modelApi: false, agents: false },
    }),
  }),
);

// The page header and the frame are what this suite reads, not the panel's
// rows; the page they name is still resolved by the real `useSettingsPage`.
vi.mock(
  '@/app/features/settings/components/settings-rail',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/settings/components/settings-rail')
    >()),
    SettingsRail: () => <nav aria-label="Settings" />,
  }),
);

const nav = enMessages.navigation;
const requestsTitle = `${nav.governance} · ${enMessages.governance.groups.dataSubjectRequests}`;

// The real router, so a navigation runs as it does in the app: the location
// names the next page at once, and the outlet keeps the current page until
// the next page's loader settles — here, only when the test opens it.
function renderSettings(initialPath: string) {
  const notificationsLoaded = Promise.withResolvers<void>();
  const root = createRootRoute({
    component: () => (
      <AdaptiveHeaderProvider>
        <Outlet />
      </AdaptiveHeaderProvider>
    ),
  });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/$id',
    component: Outlet,
  });
  const settings = createRoute({
    getParentRoute: () => dashboard,
    path: 'settings',
    component: Route.options.component,
  });
  const account = createRoute({
    getParentRoute: () => settings,
    path: 'account',
    component: () => <p>Account page</p>,
  });
  const notifications = createRoute({
    getParentRoute: () => settings,
    path: 'notifications',
    loader: () => notificationsLoaded.promise,
    component: () => <p>Notifications page</p>,
  });
  const governance = createRoute({
    getParentRoute: () => settings,
    path: 'governance',
    component: Outlet,
  });
  const requests = createRoute({
    getParentRoute: () => governance,
    path: 'data-subject-requests',
    component: () => (
      <>
        <p>Requests list</p>
        <Outlet />
      </>
    ),
  });
  const request = createRoute({
    getParentRoute: () => requests,
    path: '$requestId',
    component: () => <p>Request drawer</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([
      dashboard.addChildren([
        settings.addChildren([
          account,
          notifications,
          governance.addChildren([requests.addChildren([request])]),
        ]),
      ]),
    ]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  render(<RouterProvider router={router} />);
  return {
    router,
    loadNotifications: () => notificationsLoaded.resolve(),
  };
}

const pageHeading = () => screen.getByRole('heading', { level: 1 });

describe('Settings page switch', () => {
  it('leaves the open page and its header as they are until the next page has loaded', async () => {
    const { router, loadNotifications } = renderSettings(
      '/dashboard/org-1/settings/account',
    );
    const account = await screen.findByText('Account page');
    expect(pageHeading()).toHaveTextContent(nav.account);

    act(() => {
      void router.navigate({
        to: '/dashboard/$id/settings/notifications',
        params: { id: 'org-1' },
      });
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/dashboard/org-1/settings/notifications',
      ),
    );

    // The same element under the same header: nothing was built again.
    expect(screen.getByText('Account page')).toBe(account);
    expect(pageHeading()).toHaveTextContent(nav.account);

    await act(async () => loadNotifications());
    expect(await screen.findByText('Notifications page')).toBeInTheDocument();
    expect(account).not.toBeInTheDocument();
    expect(pageHeading()).toHaveTextContent(nav.notifications);
  });

  it('opens the next page at its top, with no fade', async () => {
    const { router, loadNotifications } = renderSettings(
      '/dashboard/org-1/settings/account',
    );
    const accountFrame = (await screen.findByText('Account page'))
      .parentElement;
    if (accountFrame === null) throw new Error('the page has no frame');
    accountFrame.scrollTop = 240;
    loadNotifications();

    await act(() =>
      router.navigate({
        to: '/dashboard/$id/settings/notifications',
        params: { id: 'org-1' },
      }),
    );

    const frame = (await screen.findByText('Notifications page')).parentElement;
    expect(frame).not.toBe(accountFrame);
    expect(frame?.scrollTop).toBe(0);
    expect(frame?.className).not.toMatch(/animate-in|fade-in/);
  });

  it('keeps the page, its frame and its scroll under a drawer route inside it', async () => {
    const { router } = renderSettings(
      '/dashboard/org-1/settings/governance/data-subject-requests',
    );
    const list = await screen.findByText('Requests list');
    const frame = list.parentElement;
    if (frame === null) throw new Error('the page has no frame');
    frame.scrollTop = 240;
    expect(pageHeading()).toHaveTextContent(requestsTitle);

    await act(() =>
      router.navigate({
        to: '/dashboard/$id/settings/governance/data-subject-requests/$requestId',
        params: { id: 'org-1', requestId: 'request-1' },
      }),
    );

    expect(await screen.findByText('Request drawer')).toBeInTheDocument();
    expect(screen.getByText('Requests list')).toBe(list);
    expect(list.parentElement).toBe(frame);
    expect(frame.scrollTop).toBe(240);
    expect(pageHeading()).toHaveTextContent(requestsTitle);
  });
});

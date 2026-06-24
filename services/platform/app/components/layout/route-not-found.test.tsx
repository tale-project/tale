import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../messages/en.json';
import { RouteNotFound } from './route-not-found';

const notFound = enMessages.common.notFound;

// Build a memory router whose shape mirrors the real dashboard nesting: a
// `/dashboard/$id` layout (the shell), a nested `settings` layout with its own
// `<Outlet/>`, and a settings index — none of the nested routes carries a splat,
// exactly like the production tree. `RouteNotFound` is wired as the router-wide
// `defaultNotFoundComponent`, the same wiring as `app/router.tsx`.
function renderAt(initialPath: string) {
  const rootRoute = createRootRoute({ component: Outlet });

  const dashboardIdRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dashboard/$id',
    component: () => (
      <div>
        <nav data-testid="dashboard-shell">shell-nav</nav>
        <Outlet />
      </div>
    ),
  });

  const settingsRoute = createRoute({
    getParentRoute: () => dashboardIdRoute,
    path: 'settings',
    component: () => (
      <div data-testid="settings-shell">
        <Outlet />
      </div>
    ),
  });

  const settingsIndexRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: '/',
    component: () => <div>settings index</div>,
  });

  const routeTree = rootRoute.addChildren([
    dashboardIdRoute.addChildren([
      settingsRoute.addChildren([settingsIndexRoute]),
    ]),
  ]);

  const router = createRouter({
    routeTree,
    defaultNotFoundComponent: RouteNotFound,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });

  return render(<RouterProvider router={router} />);
}

describe('RouteNotFound', () => {
  // The gap the existing `/dashboard/$id/$` splat leaves: a miss under a nested
  // dashboard layout (no splat of its own) must still render the styled 404 —
  // heading + recovery link — with the dashboard shell/nav intact.
  it('renders the styled dashboard 404 for a miss under a nested layout', async () => {
    renderAt('/dashboard/org-1/settings/this-route-does-not-exist');

    expect(
      await screen.findByRole('heading', { level: 1, name: notFound.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(notFound.description)).toBeInTheDocument();

    // Recovery link points back at the org dashboard, derived from the `$id`
    // param threaded through the matched dashboard subtree.
    expect(
      screen.getByRole('link', { name: notFound.backToDashboard }),
    ).toHaveAttribute('href', '/dashboard/org-1');

    // The dashboard shell stays mounted — the 404 fills the content area only.
    expect(screen.getByTestId('dashboard-shell')).toBeInTheDocument();
  });

  // Outside the dashboard subtree there is no org context, so the dashboard 404
  // (with its org recovery link) must NOT appear; we keep the minimal fallback.
  it('keeps the minimal fallback for a non-dashboard miss', async () => {
    renderAt('/totally-unknown-marketing-path');

    expect(await screen.findByText('Not Found')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: notFound.backToDashboard }),
    ).not.toBeInTheDocument();
  });
});

import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import enMessages from '../../../messages/en.yml';
import { RouteNotFound } from './route-not-found';

const notFoundMeta = enMessages.metadata.notFound;
// The "Page not found" document title the `/dashboard/$id/$` splat sets via
// `seo('notFound')` — title + the global metadata suffix.
const notFoundDocumentTitle = `${notFoundMeta.title} - ${enMessages.metadata.suffix}`;

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
  // The document-title effect restores the prior title on unmount; reset between
  // tests so one case can't leak its title into the next.
  afterEach(() => {
    document.title = '';
  });

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

    // The defect in #2097: a head-less nested layout left the document title at
    // the marketing default. We now set the same "Page not found" title the
    // splat sets via `seo('notFound')`, so nested misses stay consistent.
    await waitFor(() => expect(document.title).toBe(notFoundDocumentTitle));
  });

  // Outside the dashboard subtree there is no org context, so the dashboard 404
  // (with its org recovery link) must NOT appear; we keep the minimal fallback.
  it('keeps the minimal fallback for a non-dashboard miss', async () => {
    renderAt('/totally-unknown-marketing-path');

    expect(await screen.findByText('Not Found')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: notFound.backToDashboard }),
    ).not.toBeInTheDocument();

    // No org context means no title override either — TanStack's default
    // behaviour is preserved untouched outside the dashboard subtree.
    expect(document.title).not.toBe(notFoundDocumentTitle);
  });
});

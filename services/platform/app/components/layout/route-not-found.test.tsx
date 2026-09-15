import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

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
// exactly like the production tree. Beside it sits a pathless layout that frames
// its pages in the `main` landmark, like the sign-in pages' `/_auth`.
// `RouteNotFound` is wired as the router-wide `defaultNotFoundComponent`, the
// same wiring as `app/router.tsx`.
function renderAt(initialPath: string) {
  const rootRoute = createRootRoute({ component: Outlet });

  const authRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_auth',
    component: () => (
      <main id="main-content">
        <Outlet />
      </main>
    ),
  });

  const logInRoute = createRoute({
    getParentRoute: () => authRoute,
    path: 'log-in',
    component: () => <div>log in form</div>,
  });

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
    authRoute.addChildren([logInRoute]),
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

  // Outside the dashboard subtree there is no shell and no org to name: the miss
  // used to render the bare framework "Not Found" string. It now stands as a page
  // of its own — the same not-found state under the logo home link — and its
  // recovery link goes to `/dashboard`, which picks the organization (or asks for
  // a log-in first).
  it('renders the standalone 404 page for a non-dashboard miss', async () => {
    const { container } = renderAt('/totally-unknown-path');

    expect(
      await screen.findByRole('heading', { level: 1, name: notFound.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(notFound.description)).toBeInTheDocument();
    expect(screen.queryByText('Not Found')).not.toBeInTheDocument();

    expect(
      screen.getByRole('link', { name: notFound.backToDashboard }),
    ).toHaveAttribute('href', '/dashboard');

    // The page keeps the skip link's target and a way home through the logo.
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(
      within(screen.getByRole('banner')).getByRole('link'),
    ).toHaveAttribute('href', '/');

    await waitFor(() => expect(document.title).toBe(notFoundDocumentTitle));
    await checkAccessibility(container);
  });

  // A path beneath a sign-in page bottoms out at the pathless sign-in layout,
  // which already frames its outlet with the logo and the `main` landmark. The
  // 404 takes that frame instead of nesting a second page inside it — one
  // `main`, one `#main-content`.
  it('renders the 404 inside a layout that already frames the page', async () => {
    const { container } = renderAt('/log-in/typo');

    expect(
      await screen.findByRole('heading', { level: 1, name: notFound.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: notFound.backToDashboard }),
    ).toHaveAttribute('href', '/dashboard');

    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(container.querySelectorAll('#main-content')).toHaveLength(1);
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();

    await waitFor(() => expect(document.title).toBe(notFoundDocumentTitle));
  });
});

import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@tale/ui/adaptive-header';
import {
  createMemoryHistory,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRoute,
} from '@tanstack/react-router';
import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';

import { renderApp } from './render';

/*
 * What a page test needs and the router stub of the kit does not have: the page
 * on a real router, so links navigate, `validateSearch` runs and the address can
 * be read again after what the person did, in the frame that gives the page its
 * header slot and its `main`. A test starts at an address:
 *
 *     const root = createRootRoute({ component: PageFrame });
 *     const page = createRoute({ getParentRoute: () => root, path: '/proxies', component: ProxiesPage });
 *     const { router } = renderRouter(root.addChildren([page]), '/proxies?q=198.51');
 */

/**
 * The frame the shell gives a page: the header slot the page fills, and its
 * `main`. `children` adds what lies beside them (a toast viewport, say).
 */
export function PageFrame({ children }: { children?: ReactNode }) {
  return (
    <AdaptiveHeaderProvider>
      <header>
        <AdaptiveHeaderSlot />
      </header>
      <main>
        <Outlet />
      </main>
      {children}
    </AdaptiveHeaderProvider>
  );
}

/** A route that stands for a page the page under test links to. */
export function standIn(root: AnyRoute, path: string, text: string) {
  return createRoute({
    getParentRoute: () => root,
    path,
    component: () => <p>{text}</p>,
  });
}

/**
 * Mounts a route tree on a router of its own, at an address, in the app's
 * providers. `around` puts the router inside more of them (the theme).
 */
export function renderRouter(
  routeTree: AnyRoute,
  address: string,
  around: (router: ReactElement) => ReactElement = (router) => router,
) {
  // The router restores the scroll position on every navigation; jsdom has no
  // window to scroll and says so on every one.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [address] }),
  });
  const view = renderApp(around(<RouterProvider router={router} />));
  return { ...view, router };
}

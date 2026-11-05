import { GlobalErrorDisplay } from '@tale/ui/error-boundaries/global-error-display';
import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';

import { NotFoundPage } from './components/layout/not-found-page';
import { queryClient as appQueryClient } from './lib/query-client';
import { retryFor } from './lib/stale-bundle-reload';
import { routeTree } from './routeTree.gen';

/**
 * What every route's loader is given: the query client the pages read from,
 * so a loader warms the very entries a page's hooks then find. As on the
 * platform (`services/platform/app/router.tsx`).
 */
export interface RouterContext {
  queryClient: QueryClient;
}

/**
 * The app's router. `history` is where it reads the address from: the
 * browser's, unless a test gives it one of its own; `queryClient` is the one
 * its loaders fill, the app's unless a test gives it the one it renders with.
 */
export function createAppRouter({
  queryClient = appQueryClient,
  ...options
}: { history?: RouterHistory; queryClient?: QueryClient } = {}) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    // An address that no route knows shows the same page wherever it breaks
    // off (`/settings/typo` as much as `/typo`). Left to the section it breaks
    // off in, the page would sit in a layout made for that section's own
    // pages, under a header of its own.
    notFoundMode: 'root',
    defaultNotFoundComponent: NotFoundPage,
    // A page that fails to render shows the platform's error page (its words,
    // a way to try again, the error behind "Show details") instead of
    // TanStack's bare one, which prints the error's message in English.
    // Mirrors `services/platform/app/router.tsx`. Try again renders the page
    // again, or reloads it after a chunk the page could not fetch (a tab that
    // outlived an update), which the route would keep failing on.
    defaultErrorComponent: ({ error, reset }) => (
      <GlobalErrorDisplay error={error} reset={retryFor(error, reset)} />
    ),
    ...options,
  });
}

export const router = createAppRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

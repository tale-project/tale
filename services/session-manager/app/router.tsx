import { GlobalErrorDisplay } from '@tale/ui/error-boundaries/global-error-display';
import { createRouter, type RouterHistory } from '@tanstack/react-router';

import { NotFoundPage } from './components/layout/not-found-page';
import { retryFor } from './lib/stale-bundle-reload';
import { routeTree } from './routeTree.gen';

/**
 * The app's router. `history` is where it reads the address from: the
 * browser's, unless a test gives it one of its own.
 */
export function createAppRouter(options: { history?: RouterHistory } = {}) {
  return createRouter({
    routeTree,
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

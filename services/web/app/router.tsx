import { reportBrowserError } from '@tale/ui/monitoring/browser';
import { createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

export const router = createRouter({
  routeTree,
  defaultOnCatch: reportBrowserError,
  defaultPreload: 'intent',
});

// TanStack owns hash navigation after the destination has rendered. A second
// onResolved scroll raced that built-in scroll and could pull the reader back
// to an anchor after they had already continued down the page.

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

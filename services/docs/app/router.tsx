import { createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

// Vite injects BASE_URL from the `base` config (always trailing-slashed).
// TanStack Router wants the prefix without the trailing slash, and undefined
// when mounted at root.
const basepath =
  import.meta.env.BASE_URL.replace(/\/$/, '') || undefined;

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  basepath,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

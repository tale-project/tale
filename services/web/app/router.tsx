import { createRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

if (typeof window !== 'undefined') {
  // Smooth-scroll to the URL hash after each client-side navigation. Bound
  // once at module init rather than in a component effect so it isn't tied
  // to any single view in the layout tree.
  router.subscribe('onResolved', () => {
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;
    requestAnimationFrame(() => {
      const target = document.getElementById(hash);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

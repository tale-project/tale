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
  //
  // `onResolved` fires on every resolution — including hover-triggered
  // preloads from `defaultPreload: 'intent'`. We only want to scroll when
  // the hash actually changes, otherwise hovering a Link with the page
  // already at `/#features` would re-snap the scroll back to the anchor.
  // `undefined` (not `''`) on first run so the initial resolution still
  // scrolls when the page was loaded directly at `/#anchor`.
  let lastHash: string | undefined;
  router.subscribe('onResolved', () => {
    const currentHash = window.location.hash;
    if (currentHash === lastHash) return;
    lastHash = currentHash;
    const hash = currentHash.slice(1);
    if (!hash) return;
    requestAnimationFrame(() => {
      const target = document.getElementById(hash);
      if (!target) return;
      const prefersReducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      target.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

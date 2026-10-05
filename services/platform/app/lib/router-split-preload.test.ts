// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The build splits every route component outside the sign-in pages and the
// landing into a chunk of its own (`ENTRY_ROUTES` in `vite.config.ts`), so
// preloading such a route waits on its chunk. A navigation that commits
// meanwhile drops the cached match of a route without a loader, and
// router-core 1.168.9 then read the vanished match after the wait:
// `TypeError: Cannot read properties of undefined (reading '_nonReactive')`,
// logged on every landing through `/` or `/dashboard` while the sidebar's
// links preloaded their sections.
// `patches/@tanstack%2Frouter-core@1.168.9.patch` returns early instead, as
// the router already does when the match is gone before its loader runs.

function routerWithSplitRoute() {
  let releaseChunk = () => {};
  let markImportStarted = () => {};
  const importStarted = new Promise<void>((resolve) => {
    markImportStarted = resolve;
  });
  const chunk = new Promise<{ default: () => null }>((resolve) => {
    releaseChunk = () => resolve({ default: () => null });
  });
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/',
        component: () => null,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/elsewhere',
        component: () => null,
      }),
      // What the code splitter makes of a route without a loader.
      createRoute({
        getParentRoute: () => root,
        path: '/split',
        component: lazyRouteComponent(() => {
          markImportStarted();
          return chunk;
        }),
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    isServer: false,
  });
  return { router, importStarted, releaseChunk };
}

describe('preloading a split route that a navigation outlives', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('settles quietly once its chunk arrives', async () => {
    const { router, importStarted, releaseChunk } = routerWithSplitRoute();
    await router.load();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const preload = router.preloadRoute({ to: '/split' });
    await importStarted;
    await router.navigate({ href: '/elsewhere' });
    releaseChunk();
    await preload;

    expect(errors).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/elsewhere');
  });

  it('still preloads the route when nothing intervenes', async () => {
    const { router, importStarted, releaseChunk } = routerWithSplitRoute();
    await router.load();

    const preload = router.preloadRoute({ to: '/split' });
    await importStarted;
    releaseChunk();
    const matches = await preload;
    const split = matches?.at(-1);

    expect(split?.routeId).toBe('/split');
    expect(split && router.getMatch(split.id)?.status).toBe('success');
  });
});

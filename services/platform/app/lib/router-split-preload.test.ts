// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A preload in router-core 1.168.9 reads its match again once its wait ends,
// and a navigation in the meantime can have dropped it:
// `TypeError: Cannot read properties of undefined (reading '_nonReactive')`,
// which `preloadRoute` logs. A preload gets there two ways.
// - The build splits every route component outside the sign-in pages and the
//   landing into a chunk of its own (`ENTRY_ROUTES` in `vite.config.ts`), so
//   preloading such a route waits on its chunk, and a navigation that commits
//   meanwhile drops the cached match of a route without a loader. It was
//   logged on every landing through `/` or `/dashboard` while the sidebar's
//   links preloaded their sections.
// - A route whose loader the router awaits needs no split. Opening it while
//   the preload's loader runs makes the preload's match the navigation's
//   pending one, and leaving before the loader answers drops it; a route left
//   unopened keeps its match cached. The projects list preloads a project on
//   row hover, and the project page's loader awaits the project for the
//   document title.
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

function routerWithAwaitedLoader() {
  let answer = () => {};
  let markLoaderStarted = () => {};
  const loaderStarted = new Promise<void>((resolve) => {
    markLoaderStarted = resolve;
  });
  const project = new Promise<{ name: string }>((resolve) => {
    answer = () => resolve({ name: 'Apollo' });
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
      // Shaped like the project page, whose loader awaits the project.
      createRoute({
        getParentRoute: () => root,
        path: '/project',
        loader: async () => {
          markLoaderStarted();
          return { projectName: (await project).name };
        },
        component: () => null,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    isServer: false,
  });
  return { router, loaderStarted, answer };
}

describe('preloading a route that is opened and left before its loader answers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('settles quietly, and the route opens again', async () => {
    const { router, loaderStarted, answer } = routerWithAwaitedLoader();
    await router.load();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const preload = router.preloadRoute({ to: '/project' });
    await loaderStarted;
    const opening = router.navigate({ href: '/project' });
    await router.navigate({ href: '/elsewhere' });
    answer();
    await Promise.all([preload, opening]);

    expect(errors).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/elsewhere');

    await router.navigate({ href: '/project' });
    const project = router.state.matches.at(-1);

    expect(project?.routeId).toBe('/project');
    expect(project?.status).toBe('success');
    expect(project?.loaderData).toEqual({ projectName: 'Apollo' });
  });
});

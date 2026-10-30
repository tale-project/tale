import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { load, render, createRoot, report, replaceHistory, routerState } =
  vi.hoisted(() => {
    const renderRoot = vi.fn();
    return {
      load: vi.fn(),
      render: renderRoot,
      createRoot: vi.fn(() => ({ render: renderRoot })),
      report: vi.fn(),
      replaceHistory: vi.fn(),
      routerState: {} as { redirect?: { options: Record<string, unknown> } },
    };
  });

vi.mock('@tale/ui/analytics/browser', () => ({
  startBrowserAnalytics: vi.fn(),
}));
vi.mock('@tale/ui/app-shell', () => ({ AppShell: () => null }));
vi.mock('@tale/ui/monitoring/browser', () => ({
  initBrowserMonitoring: vi.fn(),
  reportBrowserError: report,
}));
vi.mock('@tanstack/react-router', () => ({ RouterProvider: () => null }));
vi.mock('react-dom/client', () => ({ createRoot }));
vi.mock('@/lib/i18n/i18n', () => ({ i18n: {} }));
vi.mock('./router', () => ({
  router: {
    load,
    state: routerState,
    resetNextScroll: true,
    history: {
      location: {
        href: '/#features',
        state: { __TSR_index: 3, __TSR_key: 'initial' },
      },
      replace: replaceHistory,
    },
  },
}));

describe('marketing cold start', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete routerState.redirect;
    window.history.replaceState({}, '', '/');
    document.body.innerHTML =
      '<div id="root"><main>Prerendered page</main></div>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves existing history state while suppressing initial hash replay', async () => {
    window.history.replaceState({}, '', '/#features');
    vi.stubGlobal('scrollY', 1200);
    const locationReady = Promise.withResolvers<void>();
    load
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(locationReady.promise);
    await import('./main');

    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(replaceHistory).toHaveBeenCalledWith('/#features', {
      __TSR_index: 3,
      __TSR_key: 'initial',
      __hashScrollIntoViewOptions: false,
    });
    expect(createRoot).not.toHaveBeenCalled();
    locationReady.resolve();
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
  });

  it('allows the initial hash when the page has not been positioned yet', async () => {
    window.history.replaceState({}, '', '/#features');
    vi.stubGlobal('scrollY', 0);
    load.mockResolvedValue(undefined);
    await import('./main');

    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    expect(load).toHaveBeenCalledOnce();
    expect(replaceHistory).not.toHaveBeenCalled();
  });

  it('retains the prerendered document until the initial route is ready', async () => {
    const ready = Promise.withResolvers<void>();
    load.mockReturnValue(ready.promise);
    await import('./main');

    expect(load).toHaveBeenCalledOnce();
    expect(createRoot).not.toHaveBeenCalled();
    expect(document.querySelector('main')?.textContent).toBe(
      'Prerendered page',
    );

    ready.resolve();
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    expect((await import('./router')).router.resetNextScroll).toBe(false);
    expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'), {
      onUncaughtError: report,
    });
  });

  // The hash case would also replay the initial load before mounting.
  for (const [start, scrollY] of [
    ['/ui?source=cold', 0],
    ['/de/ui?source=cold#intro', 1200],
  ] as const) {
    it(`keeps the prerendered page once ${start} sends the document off-site`, async () => {
      window.history.replaceState({}, '', start);
      vi.stubGlobal('scrollY', scrollY);
      load.mockImplementation(async () => {
        // An absolute `href` (the UI guide aliases): router-core marks the
        // redirect `reloadDocument` and has called location.replace by now.
        routerState.redirect = {
          options: {
            href: 'https://ui.tale.dev?source=cold',
            reloadDocument: true,
          },
        };
      });
      await import('./main');
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Any further load (a mount's, through the router's Transitioner, or
      // the hash replay) would repeat the off-site navigation.
      expect(load).toHaveBeenCalledOnce();
      expect(replaceHistory).not.toHaveBeenCalled();
      expect(createRoot).not.toHaveBeenCalled();
      expect(document.querySelector('main')?.textContent).toBe(
        'Prerendered page',
      );
    });
  }

  it('mounts after an initial redirect that stays in the app', async () => {
    load.mockImplementation(async () => {
      routerState.redirect = { options: { href: '/pricing?source=legacy' } };
    });
    await import('./main');

    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    expect(load).toHaveBeenCalledOnce();
  });

  it('reports an initial load error and still mounts the router error surface', async () => {
    const error = new Error('Initial route unavailable');
    load.mockRejectedValue(error);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('./main');

    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    expect(report).toHaveBeenCalledWith(error);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  load,
  render,
  createRoot,
  report,
  replaceHistory,
  installStaleBundleReload,
} = vi.hoisted(() => {
  const renderRoot = vi.fn();
  return {
    load: vi.fn(),
    render: renderRoot,
    createRoot: vi.fn(() => ({ render: renderRoot })),
    report: vi.fn(),
    replaceHistory: vi.fn(),
    installStaleBundleReload: vi.fn(),
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
vi.mock('@/lib/stale-bundle-reload', () => ({ installStaleBundleReload }));
vi.mock('./router', () => ({
  router: {
    load,
    resetNextScroll: true,
    state: { isLoading: true },
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

  it('listens for chunks a deploy removed before the first route loads', async () => {
    load.mockResolvedValue(undefined);
    await import('./main');

    expect(installStaleBundleReload).toHaveBeenCalledOnce();
    expect(installStaleBundleReload.mock.invocationCallOrder[0]).toBeLessThan(
      load.mock.invocationCallOrder[0],
    );
    // A miss counts while the router loads a page, not while it preloads one.
    const [{ navigating }] = installStaleBundleReload.mock.calls[0] as [
      { navigating: () => boolean },
    ];
    const { router } = await import('./router');
    expect(navigating()).toBe(true);
    router.state.isLoading = false;
    expect(navigating()).toBe(false);
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

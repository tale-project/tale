/**
 * A tab that outlived a deploy: the first chunk a navigation can no longer
 * fetch reloads the page onto the current build, once; the same chunk missing
 * again is left to the route's error page instead of reloading in a loop, and
 * a miss while the router only preloads a link reloads nothing. Each case
 * dispatches the `vite:preloadError` Vite's preload helper raises, and a
 * "page" is one install of the handler — a reload uninstalls it and installs
 * a fresh one over the same sessionStorage, as the browser would.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installStaleBundleReload } from './stale-bundle-reload';

const CHUNK = 'https://tale.dev/assets/pricing-C4h9kQ2x.js';
const OTHER_CHUNK = 'https://tale.dev/assets/use-cases-Pq81mZ0a.js';

function chunkFailure(url = CHUNK): TypeError {
  return new TypeError(`Failed to fetch dynamically imported module: ${url}`);
}

/** What Vite's preload helper dispatches when a lazy import fails. */
function dispatchPreloadError(payload: unknown) {
  const event = Object.assign(
    new Event('vite:preloadError', { cancelable: true }),
    { payload },
  );
  window.dispatchEvent(event);
  return event;
}

/** Whether the router of the current page is loading a page or preloading. */
const router = { navigating: true };

let uninstallPage: (() => void) | undefined;

/** Loads a page; the returned mock is that page's reload. */
function loadPage() {
  uninstallPage?.();
  const reload = vi.fn();
  uninstallPage = installStaleBundleReload({
    navigating: () => router.navigating,
    reload,
  });
  return reload;
}

describe('installStaleBundleReload', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    router.navigating = true;
  });

  afterEach(() => {
    uninstallPage?.();
    uninstallPage = undefined;
    vi.restoreAllMocks();
  });

  it('reloads once for a missing chunk, then leaves the same chunk to the error page', () => {
    const firstPage = loadPage();
    const first = dispatchPreloadError(chunkFailure());
    expect(firstPage).toHaveBeenCalledTimes(1);
    // Never swallowed: the router and the error reporter still see it.
    expect(first.defaultPrevented).toBe(false);

    // The reload landed on the old build again.
    const secondPage = loadPage();
    const again = dispatchPreloadError(chunkFailure());
    expect(secondPage).not.toHaveBeenCalled();
    expect(again.defaultPrevented).toBe(false);
  });

  it('keys the reload by the chunk, so a later deploy can reload again', () => {
    loadPage();
    dispatchPreloadError(chunkFailure());

    const nextPage = loadPage();
    dispatchPreloadError(chunkFailure(OTHER_CHUNK));
    expect(nextPage).toHaveBeenCalledTimes(1);
    expect(
      window.sessionStorage.getItem(`tale:stale-bundle-reload:${OTHER_CHUNK}`),
    ).toBe('1');
  });

  it('waits for the navigation when a preloaded link misses its chunk', () => {
    const reload = loadPage();
    router.navigating = false;
    dispatchPreloadError(chunkFailure());
    expect(reload).not.toHaveBeenCalled();
    expect(window.sessionStorage).toHaveLength(0);

    // The reader follows the link, and the navigation meets the miss again.
    router.navigating = true;
    dispatchPreloadError(chunkFailure());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'WebKit, whose message names no chunk',
      'Importing a module script failed.',
    ],
    ['Firefox', `error loading dynamically imported module: ${CHUNK}`],
    [
      'a stylesheet of the chunk',
      'Unable to preload CSS for https://tale.dev/assets/pricing-D0c5sX1a.css',
    ],
  ])('treats a failure from %s the same way', (_source, message) => {
    const firstPage = loadPage();
    dispatchPreloadError(new TypeError(message));
    expect(firstPage).toHaveBeenCalledTimes(1);

    const secondPage = loadPage();
    dispatchPreloadError(new TypeError(message));
    expect(secondPage).not.toHaveBeenCalled();
  });

  it('leaves a chunk that loaded and then threw to its caller', () => {
    const reload = loadPage();
    dispatchPreloadError(new ReferenceError('pricingTiers is not defined'));
    expect(reload).not.toHaveBeenCalled();
    expect(window.sessionStorage).toHaveLength(0);
  });

  it('does not reload when it cannot remember the attempt', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException(
        'The quota has been exceeded.',
        'QuotaExceededError',
      );
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reload = loadPage();
    dispatchPreloadError(chunkFailure());
    expect(reload).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stops listening once uninstalled', () => {
    const reload = loadPage();
    uninstallPage?.();
    uninstallPage = undefined;
    dispatchPreloadError(chunkFailure());
    expect(reload).not.toHaveBeenCalled();
  });
});

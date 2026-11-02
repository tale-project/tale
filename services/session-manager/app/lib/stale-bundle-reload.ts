/**
 * Reload for a tab that outlived an update.
 *
 * Client navigation loads each route's component as a chunk of its own
 * (`autoCodeSplitting` in `vite.config.ts`). An update of the manager replaces
 * those content-hashed files, so a tab opened before it can miss the chunks its
 * next navigation asks for; Vite reports each miss as `vite:preloadError`.
 *
 * A miss while the router loads a page — a navigation, or the first load —
 * reloads the page, which brings the tab onto the current build at the address
 * the person asked for. A miss while the router only preloads a hovered or
 * focused link reloads nothing: the person has not asked for that page yet,
 * and the navigation that follows meets the miss again.
 *
 * The reload is remembered for the tab's session in the record
 * `lazyRouteComponent` keeps of its own, so the tab reloads once per chunk
 * whichever of the two notices the miss first. A chunk that misses again after
 * its reload does not reload again: the route shows the error page, whose Try
 * again reloads on request (`retryFor`). The event is never prevented, so the
 * failure still reaches the router as itself.
 *
 * Mirrors the marketing site's `services/web/lib/stale-bundle-reload.ts`.
 * Installed once from `app/main.tsx`, before the first route loads.
 */

import { claimReload, isChunkLoadFailure } from '@tale/ui/stale-bundle';

/**
 * The record of the reload a tab made for `error`: the key under which
 * `lazyRouteComponent` (`@tanstack/react-router`) remembers the reload it makes
 * when a preloaded route component missed its chunk. The message names the
 * chunk, except in WebKit, whose misses then share one record. Shared, the
 * router does not reload again for a miss this handler reloaded for, nor this
 * handler on the page the router's reload brought.
 */
function reloadRecord(error: Error): string {
  return `tanstack_router_reload:${error.message}`;
}

/** A full page load: the way back from a chunk the page could not fetch. */
export function reloadPage(): void {
  window.location.reload();
}

/**
 * What Try again does on the error page. A chunk the page could not fetch stays
 * failed for the page's lifetime (`lazyRouteComponent` keeps its error), so
 * after one of those it reloads the page; any other failure is rendered again.
 */
export function retryFor(error: unknown, reset: () => void): () => void {
  return isChunkLoadFailure(error) ? reloadPage : reset;
}

interface StaleBundleReloadOptions {
  /**
   * Whether the router is loading a page the person asked for, rather than
   * preloading one they point at.
   */
  navigating: () => boolean;
  /** Reloads the page — injectable because jsdom cannot. */
  reload?: () => void;
}

/**
 * Listens for missed chunks for the page's lifetime. Returns the uninstall, for
 * tests; the app installs it once.
 */
export function installStaleBundleReload({
  navigating,
  reload = reloadPage,
}: StaleBundleReloadOptions): () => void {
  const onPreloadError = (event: VitePreloadErrorEvent) => {
    const error: unknown = event.payload;
    if (!isChunkLoadFailure(error) || !navigating()) return;
    if (claimReload(reloadRecord(error))) reload();
  };

  window.addEventListener('vite:preloadError', onPreloadError);
  return () => {
    window.removeEventListener('vite:preloadError', onPreloadError);
  };
}

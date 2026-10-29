/**
 * Reload for a tab that outlived a deploy.
 *
 * Client navigation loads each route's component as a chunk of its own
 * (`autoCodeSplitting` in `vite.config.ts`), and the compare and use-case
 * loaders import each page's body the same way (`lib/content/client.ts`). A
 * deploy replaces those content-hashed files, so a tab opened before it can
 * miss the chunks its next navigation asks for; Vite reports each miss as
 * `vite:preloadError`.
 *
 * A miss while the router loads a page — a navigation, or the first load —
 * reloads the page, which brings the tab onto the current build at the
 * address the reader asked for. A miss while the router only preloads a
 * hovered or focused link reloads nothing: the reader has not asked for that
 * page yet, and the navigation that follows meets the miss again (a body is
 * imported anew, and `lazyRouteComponent` reloads for a route's component
 * when it renders).
 *
 * The reload is remembered for the tab's session under the chunk's URL, so a
 * chunk that misses again after its reload — the reload landed on the old
 * build mid-rollout, or the file really is gone — does not reload again: the
 * route shows the error page (`app/pages/error-page.tsx`), whose Try again
 * reloads on request. The event is never prevented, so the failure still
 * reaches the router and the error reporter as itself.
 *
 * Installed once from `app/main.tsx`, before the first route loads.
 */

import {
  claimReload,
  failedChunkUrl,
  isChunkLoadFailure,
} from '@tale/ui/stale-bundle';

const STORAGE_PREFIX = 'tale:stale-bundle-reload:';

/** A full page load: the way back from a chunk the page could not fetch. */
export function reloadPage(): void {
  window.location.reload();
}

interface StaleBundleReloadOptions {
  /**
   * Whether the router is loading a page the reader asked for, rather than
   * preloading one they point at.
   */
  navigating: () => boolean;
  /** Reloads the page — injectable because jsdom cannot. */
  reload?: () => void;
}

/**
 * Listens for missed chunks for the page's lifetime. Returns the uninstall,
 * for tests; the site installs it once.
 */
export function installStaleBundleReload({
  navigating,
  reload = reloadPage,
}: StaleBundleReloadOptions): () => void {
  const onPreloadError = (event: VitePreloadErrorEvent) => {
    const error: unknown = event.payload;
    if (!isChunkLoadFailure(error) || !navigating()) return;
    if (claimReload(`${STORAGE_PREFIX}${failedChunkUrl(error)}`)) reload();
  };

  window.addEventListener('vite:preloadError', onPreloadError);
  return () => {
    window.removeEventListener('vite:preloadError', onPreloadError);
  };
}

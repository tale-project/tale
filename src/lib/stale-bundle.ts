/**
 * What a tab that outlived a deploy runs into, and how it remembers the one
 * reload it makes for it.
 *
 * Every lazily loaded chunk of a Vite build goes through Vite's preload
 * helper, which reports a failed load as a cancelable `vite:preloadError` on
 * `window`, with the import's error in `event.payload`. A tab opened before a
 * deploy still names the previous build's content-hashed chunks, so its next
 * lazy load can miss. The platform (`app/lib/stale-bundle-recovery.tsx`) and
 * the marketing site (`lib/stale-bundle-reload.ts`) each answer such a miss
 * with a reload the tab makes once; this module is what they share.
 */

/**
 * How each engine words a dynamic import whose module (or one of its static
 * imports) could not be fetched — a missing chunk answered with the SPA
 * shell fails the module MIME check the same way — and Vite's own wording
 * for a stylesheet the chunk needs. A module that loaded and then threw
 * rejects with its own error instead: a bug, not a stale build, so it is
 * left to its caller.
 */
const CHUNK_LOAD_FAILURES = [
  'Failed to fetch dynamically imported module', // Chromium
  'error loading dynamically imported module', // Firefox
  'Importing a module script failed', // WebKit — names no URL
  'Unable to preload CSS for', // Vite's CSS preload
];

/** Whether `error` is a chunk the page could not fetch. */
export function isChunkLoadFailure(error: unknown): error is Error {
  return (
    error instanceof Error &&
    CHUNK_LOAD_FAILURES.some((message) => error.message.includes(message))
  );
}

/** The chunk the message names; one shared slot for engines that name none. */
export function failedChunkUrl(error: Error): string {
  return /https?:\/\/\S+/.exec(error.message)?.[0] ?? 'unknown';
}

/**
 * Claims the one reload kept under `key` for the tab's session. `false` once
 * it was claimed — and when sessionStorage is unusable, since without the
 * record nothing would stop the reloaded page from reloading again.
 */
export function claimReload(key: string): boolean {
  try {
    if (window.sessionStorage.getItem(key) !== null) return false;
    window.sessionStorage.setItem(key, '1');
    return true;
  } catch (error) {
    console.warn(
      '[stale-bundle] sessionStorage is unavailable; the reload cannot be remembered, so it is not made',
      error,
    );
    return false;
  }
}

/** Hands a claimed reload back, so the next failure can claim it again. */
export function releaseReload(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch (error) {
    console.warn('[stale-bundle] could not hand the reload back', error);
  }
}

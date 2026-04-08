/**
 * Rewrite public storage URLs to internal Convex storage URLs.
 *
 * The Convex backend runs behind a proxy. Public URLs like
 * `https://example.com/api/storage/...` are unreachable from inside
 * the backend. This utility rewrites them to the internal origin
 * (e.g. `http://127.0.0.1:3210/api/storage/...`).
 *
 * Idempotent: URLs that are already internal or non-storage are returned unchanged.
 */

const STORAGE_PATH = '/api/storage/';

/**
 * Convert a public storage URL to an internal one.
 * Non-storage URLs and already-internal URLs pass through unchanged.
 */
export function toInternalStorageUrl(url: string): string {
  const storageIdx = url.indexOf(STORAGE_PATH);
  if (storageIdx === -1) return url;

  const internalOrigin =
    process.env.CONVEX_CLOUD_URL ?? 'http://127.0.0.1:3210';
  const internalPrefix = internalOrigin.replace(/\/+$/, '');

  // Already internal — return as-is
  if (url.startsWith(internalPrefix)) return url;

  // Rewrite: keep everything from /api/storage/... onwards
  return `${internalPrefix}${url.slice(storageIdx)}`;
}

/**
 * Check whether a URL points to Convex storage (public or internal).
 */
export function isStorageUrl(url: string): boolean {
  return url.includes(STORAGE_PATH);
}

/**
 * Storage URL utilities for converting between internal and public URLs.
 *
 * The Convex backend runs behind a proxy (Caddy):
 * - **Internal URLs** (`http://127.0.0.1:3210/api/storage/...`) are used for
 *   backend-to-backend reads — unreachable from the browser.
 * - **Public URLs** (`https://example.com/api/storage/...`) route through the
 *   proxy and are what users/browsers see.
 *
 * General principle:
 * - Internal reads → use `toInternalStorageUrl()`
 * - User-facing output → use `toPublicUrl()`
 */

const STORAGE_PATH = '/api/storage/';

/**
 * Get the public HTTP API base URL for building client-facing URLs.
 *
 * Returns `${SITE_URL}${BASE_PATH}/http_api` which routes through the proxy
 * to the Convex HTTP API (port 3211) internally.
 */
export function getPublicHttpApiUrl(): string {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    throw new Error('Missing required environment variable: SITE_URL');
  }
  const basePath = process.env.BASE_PATH ?? '';
  return `${siteUrl.replace(/\/$/, '')}${basePath}/http_api`;
}

/**
 * Build a download URL for a file stored in Convex storage.
 *
 * Uses the custom HTTP endpoint that sets Content-Disposition header,
 * ensuring the downloaded file has the correct filename.
 */
export function buildDownloadUrl(storageId: string, fileName: string): string {
  return `${getPublicHttpApiUrl()}/storage?id=${storageId}&filename=${encodeURIComponent(fileName)}`;
}

/**
 * Rewrite an internal Convex URL to route through the public proxy.
 *
 * Internal URLs like `http://127.0.0.1:3210/api/storage/...` are unreachable
 * from the browser. This replaces the origin with SITE_URL + BASE_PATH.
 *
 * Idempotent: if the URL already starts with `SITE_URL + BASE_PATH`, it is
 * returned unchanged so callers never need to worry about double-rewriting.
 */
export function toPublicUrl(internalUrl: string): string {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) return internalUrl;
  const basePath = process.env.BASE_PATH ?? '';
  const publicPrefix = `${siteUrl.replace(/\/$/, '')}${basePath}`;
  if (internalUrl.startsWith(publicPrefix)) return internalUrl;
  const originMatch = internalUrl.match(/^https?:\/\/[^/]+/);
  if (!originMatch) return internalUrl;
  const path = internalUrl.slice(originMatch[0].length);
  return `${publicPrefix}${path}`;
}

// =============================================================================
// Internal storage URL helpers (public → internal direction)
// =============================================================================

/**
 * Convert a public storage URL to an internal one.
 * Non-storage URLs and already-internal URLs pass through unchanged.
 *
 * Only matches `/api/storage/` in the URL **pathname** to prevent
 * bypass via query parameters or fragments (e.g. `?q=/api/storage/`).
 *
 * Idempotent: if the URL is already internal or non-storage, it is
 * returned unchanged.
 */
export function toInternalStorageUrl(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }

  if (!pathname.includes(STORAGE_PATH)) return url;

  const storageIdx = url.indexOf(STORAGE_PATH);
  if (storageIdx === -1) return url;

  const internalOrigin =
    process.env.CONVEX_CLOUD_URL ?? 'http://127.0.0.1:3210';
  const internalPrefix = internalOrigin.replace(/\/+$/, '');

  if (url.startsWith(internalPrefix)) return url;

  return `${internalPrefix}${url.slice(storageIdx)}`;
}

/**
 * Check whether a URL points to Convex storage (public or internal).
 *
 * Only matches `/api/storage/` in the URL **pathname** — not in query
 * parameters or fragments — to prevent host validation bypass.
 */
export function isStorageUrl(url: string): boolean {
  try {
    return new URL(url).pathname.includes(STORAGE_PATH);
  } catch {
    return url.includes(STORAGE_PATH);
  }
}

/**
 * Rewrite an internal Convex URL so a sandbox spawner container can reach it
 * through the Caddy proxy on the internal Docker network.
 *
 * Sister function of {@link toPublicUrl}. They differ in audience:
 *  - `toPublicUrl()` builds the **browser-facing** URL (SITE_URL public host).
 *  - `toSandboxStorageUrl()` builds the **sandbox-bound** URL using
 *    `SANDBOX_STORAGE_INTERNAL_BASE_URL` (defaults to the internal proxy
 *    alias e.g. `http://proxy` in docker compose). Spawner containers can
 *    fetch / POST through this without going out to the public hostname.
 *
 * Falls back to `toPublicUrl()` when `SANDBOX_STORAGE_INTERNAL_BASE_URL`
 * isn't set, so local `bun dev` (where the env var may be undefined) keeps
 * working — the sandbox is still reachable via the public URL form.
 *
 * Idempotent: if the URL already starts with the configured prefix it is
 * returned unchanged so callers never need to worry about double-rewriting.
 */
export function toSandboxStorageUrl(internalUrl: string): string {
  const base = process.env.SANDBOX_STORAGE_INTERNAL_BASE_URL;
  if (!base) {
    // Fallback for `bun dev` and any deploy that hasn't set the env yet.
    // The public URL is still reachable from the spawner (it just round-
    // trips through Caddy's public listener instead of the internal one).
    return toPublicUrl(internalUrl);
  }
  const prefix = base.replace(/\/$/, '');
  if (internalUrl.startsWith(prefix)) return internalUrl;
  const originMatch = internalUrl.match(/^https?:\/\/[^/]+/);
  if (!originMatch) return internalUrl;
  const path = internalUrl.slice(originMatch[0].length);
  return `${prefix}${path}`;
}

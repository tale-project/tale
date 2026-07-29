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
 * Build the `/storage` route URL for an `s3:` blob reference. A Convex query
 * cannot presign S3, so it hands the browser this URL instead; the node
 * `/storage` httpAction resolves the org's bucket (from `org`, the Better Auth
 * organization id) and 302-redirects to a short-lived presigned GET. `org` is
 * REQUIRED for an S3 ref — the route needs it to address the right bucket.
 */
export function buildBlobServeUrl(
  ref: string,
  orgId: string,
  fileName?: string,
): string {
  const base = `${getPublicHttpApiUrl()}/storage?ref=${encodeURIComponent(ref)}&org=${encodeURIComponent(orgId)}`;
  return fileName ? `${base}&filename=${encodeURIComponent(fileName)}` : base;
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
 * The in-sandbox origin of Convex — the single contract for how anything
 * running on the sandbox network reaches Convex.
 *
 * `convex` is the alias carried on the sandbox network in EVERY topology:
 *  - prod / `docker compose up`: the Convex container is dual-homed onto the
 *    sandbox net with the `convex` alias (create-convex-service.ts / compose.yml);
 *  - `bun dev`: the `convex-relay` socat bridge is aliased `convex` on the
 *    sandbox net (compose.dev.yml).
 *
 * It is the ONLY Convex origin a session container can reach: that container
 * sits on the `--internal` sandbox net (no host route) and its Node `fetch`
 * (undici) ignores the egress proxy, so it can only reach hosts DIRECTLY on
 * that network. The public SITE_URL is never reachable there — so it must NOT
 * be a fallback for sandbox-bound URLs (that was the latent bug that broke
 * storage staging in prod). Storage is served on :3210, HTTP actions /
 * connectors on :3211.
 */
export const SANDBOX_CONVEX_STORAGE_BASE_DEFAULT = 'http://convex:3210';
export const SANDBOX_CONVEX_HTTP_API_BASE_DEFAULT = 'http://convex:3211';

/**
 * Rewrite an internal Convex storage URL to the sandbox-bound form so a session
 * container's daemon can fetch it.
 *
 * Rewrites the origin to `SANDBOX_STORAGE_INTERNAL_BASE_URL` when set (operator
 * escape hatch for non-standard topologies), else to the in-sandbox `convex`
 * alias ({@link SANDBOX_CONVEX_STORAGE_BASE_DEFAULT}). It deliberately does NOT
 * fall back to the public URL ({@link toPublicUrl}) — that host is unreachable
 * from the `--internal` sandbox net.
 *
 * Idempotent: if the URL already starts with the configured prefix it is
 * returned unchanged so callers never need to worry about double-rewriting.
 */
export function toSandboxStorageUrl(internalUrl: string): string {
  const base = (
    process.env.SANDBOX_STORAGE_INTERNAL_BASE_URL ??
    SANDBOX_CONVEX_STORAGE_BASE_DEFAULT
  ).replace(/\/$/, '');
  if (internalUrl.startsWith(base)) return internalUrl;
  const originMatch = internalUrl.match(/^https?:\/\/[^/]+/);
  if (!originMatch) return internalUrl;
  const path = internalUrl.slice(originMatch[0].length);
  return `${base}${path}`;
}

/**
 * Utilities for building public-facing storage URLs.
 *
 * The Convex backend runs behind a proxy (Caddy). Internal URLs like
 * `http://127.0.0.1:3210/api/storage/...` are unreachable from the browser.
 * These helpers construct URLs that route through the proxy instead.
 */

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

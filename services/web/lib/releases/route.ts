/**
 * `GET /api/releases` — the changelog page's runtime source of truth. Shared by
 * the production server (`server.ts`) and the Vite dev middleware so both serve
 * byte-identical responses.
 */

import type { ReleaseFeed } from './feed';

export const RELEASES_ROUTE = '/api/releases';
/** Crawlable alias outside the private `/api/` robots exclusion. */
export const CHANGELOG_JSON_ROUTE = '/changelog.json';
export const RELEASES_ROUTES = [RELEASES_ROUTE, CHANGELOG_JSON_ROUTE] as const;

/**
 * Browsers may reuse a response for this long. Well under the feed's own TTL,
 * so a new release still surfaces within the hour.
 */
const MAX_AGE_S = 300;

export function handleReleasesRequest(
  request: Request,
  feed: ReleaseFeed,
): Response {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { allow: 'GET' },
    });
  }
  return Response.json(feed.read(), {
    headers: { 'cache-control': `public, max-age=${MAX_AGE_S}` },
  });
}

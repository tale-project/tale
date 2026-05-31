import { ConvexHttpClient } from 'convex/browser';

import type { WebDAVCtx } from './types';

interface MakeWebdavCtxOptions {
  // CONVEX_URL — the backend API origin (port :3210 self-hosted). The
  // ConvexHttpClient talks to this directly: its query/mutation/action calls
  // POST to /api/*, which is served ONLY by the backend, NOT the :3211
  // HTTP-actions site proxy. We derive the site origin from it for the blob
  // proxy only (see storageBaseUrl). Override individually if your topology
  // differs.
  convexUrl: string;
  // Optional explicit HTTP-actions (site) URL used for the /storage blob
  // proxy. Falls back to convexUrl with port rewritten 3210 → 3211 (the
  // docker compose convention).
  convexSiteUrl?: string;
  adminKey: string;
}

export function makeWebdavCtx(opts: MakeWebdavCtxOptions): WebDAVCtx {
  // The client MUST point at the backend (convexUrl, :3210) — query()/
  // mutation()/action() hit /api/query|mutation|action, which the :3211 site
  // proxy does not serve (it forwards to /http httpActions). Mirror the
  // working reference in services/platform/reset-owner.ts:31 which builds the
  // client straight from CONVEX_URL. Only the /storage blob proxy
  // (storageBaseUrl, used by methods/get.ts) lives on the :3211 site origin.
  const client = new ConvexHttpClient(opts.convexUrl);
  // setAdminAuth is @internal in convex types but present at runtime;
  // mirror the pattern in services/platform/reset-owner.ts:33.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const setAdminAuth = Reflect.get(client, 'setAdminAuth') as (
    token: string,
  ) => void;
  setAdminAuth.call(client, opts.adminKey);
  return {
    convex: client,
    storageBaseUrl: opts.convexSiteUrl ?? deriveSiteUrl(opts.convexUrl),
    convexApiUrl: opts.convexUrl.replace(/\/$/, ''),
  };
}

/**
 * Re-home a Convex-returned storage URL onto a reachable backend origin.
 *
 * `ctx.storage.generateUploadUrl()` / `getUrl()` bake in the backend's
 * *self-reported* origin — `http://127.0.0.1:3210` on self-hosted. That is the
 * platform container's own loopback in docker compose, where Convex is a
 * separate container reachable as `http://convex:3210` (CONVEX_URL). The browser
 * path solves this with `toPublicUrl()` (route through Caddy), but the WebDAV
 * server runs ON the internal network and should hit the backend directly by
 * service name — the same origin its ConvexHttpClient already uses.
 *
 * Swaps only protocol+host; path and query (the upload/blob token) are
 * preserved. Idempotent when the origins already match (the dev case, where
 * CONVEX_URL is also 127.0.0.1:3210). Returns the input unchanged when either
 * value isn't a parseable absolute URL — let the subsequent `fetch` surface a
 * real connection error rather than mangling the string.
 */
export function rewriteStorageOrigin(
  storageUrl: string,
  backendUrl: string,
): string {
  try {
    const target = new URL(backendUrl);
    const u = new URL(storageUrl);
    u.protocol = target.protocol;
    u.host = target.host;
    return u.toString();
  } catch {
    return storageUrl;
  }
}

function deriveSiteUrl(convexUrl: string): string {
  try {
    const u = new URL(convexUrl);
    u.port = '3211';
    return u.toString().replace(/\/$/, '');
  } catch {
    return convexUrl.replace(/:\d+$/, ':3211').replace(/\/$/, '');
  }
}

import { ConvexHttpClient } from 'convex/browser';

import type { WebDAVCtx } from './types';

export interface MakeWebdavCtxOptions {
  // CONVEX_URL — the WebSocket-side hostname. We derive the HTTP-side
  // (port :3211 by convention) from it for both blob fetches and
  // ConvexHttpClient. Override individually if your topology differs.
  convexUrl: string;
  // Optional explicit HTTP-actions URL. Falls back to convexUrl with
  // port rewritten 3210 → 3211 (the docker compose convention).
  convexSiteUrl?: string;
  adminKey: string;
}

export function makeWebdavCtx(opts: MakeWebdavCtxOptions): WebDAVCtx {
  const siteUrl = opts.convexSiteUrl ?? deriveSiteUrl(opts.convexUrl);
  const client = new ConvexHttpClient(siteUrl);
  // setAdminAuth is @internal in convex types but present at runtime;
  // mirror the pattern in services/platform/reset-owner.ts:33.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const setAdminAuth = Reflect.get(client, 'setAdminAuth') as (
    token: string,
  ) => void;
  setAdminAuth.call(client, opts.adminKey);
  return {
    convex: client,
    storageBaseUrl: siteUrl,
  };
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

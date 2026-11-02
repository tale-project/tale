/**
 * Which of the deployment's outbound proxies the next request to another
 * website goes out through.
 *
 * The proxies are `OUTBOUND_PROXY_URLS` (`@tale/shared/net/outbound-proxies`
 * reads it; the backend refuses to boot on a malformed value), and requests
 * take them in turn — round robin, counted per process. A proxy that cannot
 * be reached, or refuses its credentials, is passed over for a minute, so a
 * dead entry costs one failed attempt a minute instead of every Nth request.
 * When every proxy is passed over the rotation goes on through all of them:
 * a request never leaves unproxied because the proxies are failing (see
 * `./proxy-rotation`).
 *
 * Callers: `safeFetch` (the crawler, the chat assistant's web fetch, email
 * images) and the yt-dlp runner, which starts a video on the proxy the
 * platform last served, unless video ingestion has proxies of its own
 * (`./video-ingest-proxies`). The sandbox egress service reads the same list
 * and rotates it with squid.
 */

import {
  OUTBOUND_PROXY_URLS_ENV,
  parseOutboundProxyUrls,
  type OutboundProxy,
} from '@tale/shared/net/outbound-proxies';

import {
  PROXY_SET_ASIDE_MS,
  ProxyRotation,
  type ProxyPick,
} from './proxy-rotation';

export type { OutboundProxy };

/** How long a proxy that failed is passed over. */
export const OUTBOUND_PROXY_SET_ASIDE_MS = PROXY_SET_ASIDE_MS;

/** The outbound proxies' rotation: its turn and the proxies it passes over. */
export const outboundProxyRotation = new ProxyRotation<OutboundProxy>(
  OUTBOUND_PROXY_URLS_ENV,
  parseOutboundProxyUrls,
  'outbound-proxy',
);

/** What a caller may ask of {@link nextOutboundProxy} beyond the turn. */
export type OutboundProxyPick = ProxyPick<OutboundProxy>;

/** The proxy the next request goes out through, or null when none is
 * configured or every one is skipped. Passes over a proxy that is set aside,
 * unless every proxy it may take is. */
export function nextOutboundProxy(
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
  pick: OutboundProxyPick = {},
): OutboundProxy | null {
  return outboundProxyRotation.next(env, now, pick);
}

/** Where `proxy` stands in the list, counted from 1 as the boot check counts
 * entries (0 when it is not listed): what tells apart entries that share a
 * host and port, as a provider's per-address user names on one gateway do. */
export function outboundProxyEntry(
  proxy: OutboundProxy,
  env: NodeJS.ProcessEnv = process.env,
): number {
  return outboundProxyRotation.entry(proxy, env);
}

/** Pass over `proxy` for {@link OUTBOUND_PROXY_SET_ASIDE_MS}, after it could
 * not carry a request. `why` is logged with the proxy's host and port, never
 * its credentials. */
export function setOutboundProxyAside(
  proxy: OutboundProxy,
  why: string,
  now: number = Date.now(),
): void {
  outboundProxyRotation.setAside(proxy, why, now);
}

/** Test seam: forget the rotation's position and every set-aside proxy. */
export function resetOutboundProxiesForTests(): void {
  outboundProxyRotation.reset();
}

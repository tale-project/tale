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
 * a request never leaves unproxied because the proxies are failing.
 *
 * Callers: `safeFetch` (the crawler, the chat assistant's web fetch, email
 * images) and the yt-dlp runner, which starts a video on the proxy the
 * platform last served. The sandbox egress service reads the same list and
 * rotates it with squid.
 */

import {
  OUTBOUND_PROXY_URLS_ENV,
  parseOutboundProxyUrls,
  type OutboundProxy,
} from '@tale/shared/net/outbound-proxies';

export type { OutboundProxy };

/** How long a proxy that failed is passed over. */
export const OUTBOUND_PROXY_SET_ASIDE_MS = 60_000;

let parsed: { raw: string; proxies: readonly OutboundProxy[] } | null = null;
let cursor = 0;
/** Until when each proxy (by its URL) is passed over. */
const setAside = new Map<string, number>();

/** The configured proxies, parsed once per value; empty when none are set. */
function outboundProxies(
  env: NodeJS.ProcessEnv = process.env,
): readonly OutboundProxy[] {
  const raw = env[OUTBOUND_PROXY_URLS_ENV] ?? '';
  if (parsed?.raw !== raw) {
    parsed = { raw, proxies: parseOutboundProxyUrls(raw) };
  }
  return parsed.proxies;
}

/** What a caller may ask of {@link nextOutboundProxy} beyond the turn. */
export interface OutboundProxyPick {
  /** The one to take when it is still listed, not passed over and not
   * skipped; the rotation does not move for it. */
  prefer?: OutboundProxy | null;
  /** Proxies (by URL) never to take, every entry that lists them. */
  skip?: ReadonlySet<string>;
}

/** The proxy the next request goes out through, or null when none is
 * configured or every one is skipped. Passes over a proxy that is set aside,
 * unless every proxy it may take is. */
export function nextOutboundProxy(
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
  { prefer = null, skip }: OutboundProxyPick = {},
): OutboundProxy | null {
  const proxies = outboundProxies(env);
  if (proxies.length === 0) return null;
  const usable = (proxy: OutboundProxy): boolean => !skip?.has(proxy.url);
  if (
    prefer !== null &&
    usable(prefer) &&
    (setAside.get(prefer.url) ?? 0) <= now
  ) {
    const listed = proxies.find((proxy) => proxy.url === prefer.url);
    if (listed !== undefined) return listed;
  }
  const start = cursor % proxies.length;
  let passedOver: number | null = null;
  for (let offset = 0; offset < proxies.length; offset += 1) {
    const index = (start + offset) % proxies.length;
    const proxy = proxies[index];
    if (proxy === undefined || !usable(proxy)) continue;
    if ((setAside.get(proxy.url) ?? 0) <= now) {
      cursor = (index + 1) % proxies.length;
      return proxy;
    }
    passedOver ??= index;
  }
  if (passedOver === null) return null;
  // Every proxy left is passed over: the rotation goes on through all of them.
  cursor = (passedOver + 1) % proxies.length;
  return proxies[passedOver] ?? null;
}

/** Where `proxy` stands in the list, counted from 1 as the boot check counts
 * entries (0 when it is not listed): what tells apart entries that share a
 * host and port, as a provider's per-address user names on one gateway do. */
export function outboundProxyEntry(
  proxy: OutboundProxy,
  env: NodeJS.ProcessEnv = process.env,
): number {
  return (
    outboundProxies(env).findIndex((listed) => listed.url === proxy.url) + 1
  );
}

/** Pass over `proxy` for {@link OUTBOUND_PROXY_SET_ASIDE_MS}, after it could
 * not carry a request. `why` is logged with the proxy's host and port, never
 * its credentials. */
export function setOutboundProxyAside(
  proxy: OutboundProxy,
  why: string,
  now: number = Date.now(),
): void {
  const passedOver = (setAside.get(proxy.url) ?? 0) > now;
  setAside.set(proxy.url, now + OUTBOUND_PROXY_SET_ASIDE_MS);
  if (!passedOver) {
    console.warn(
      `[outbound-proxy] ${proxy.label} failed (${why}); passing over it for ${OUTBOUND_PROXY_SET_ASIDE_MS / 1000} s`,
    );
  }
}

/** Test seam: forget the rotation's position and every set-aside proxy. */
export function resetOutboundProxiesForTests(): void {
  parsed = null;
  cursor = 0;
  setAside.clear();
}

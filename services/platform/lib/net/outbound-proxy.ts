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
 * images) and the yt-dlp runner. The sandbox egress service reads the same
 * list and rotates it with squid.
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

/** The proxy the next request goes out through, or null when none is
 * configured. Skips a proxy that is passed over unless all of them are. */
export function nextOutboundProxy(
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): OutboundProxy | null {
  const proxies = outboundProxies(env);
  if (proxies.length === 0) return null;
  const start = cursor % proxies.length;
  for (let offset = 0; offset < proxies.length; offset += 1) {
    const index = (start + offset) % proxies.length;
    const proxy = proxies[index];
    if (proxy !== undefined && (setAside.get(proxy.url) ?? 0) <= now) {
      cursor = (index + 1) % proxies.length;
      return proxy;
    }
  }
  // Every proxy is passed over: the rotation goes on through all of them.
  cursor = (start + 1) % proxies.length;
  return proxies[start] ?? null;
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

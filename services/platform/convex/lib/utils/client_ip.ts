import type { IncomingMessage } from 'node:http';

import proxyaddr from 'proxy-addr';

import { internal } from '../../_generated/api';
import type { ActionCtx, MutationCtx } from '../../_generated/server';

/**
 * Extract the real client IP from a Request.
 *
 * Uses `proxy-addr` to walk the `X-Forwarded-For` chain right-to-left,
 * skipping every hop that matches a trusted-proxy entry, and returns
 * the first non-trusted IP — the real client, even if it tried to
 * spoof `X-Forwarded-For`.
 *
 * `trusted` is an array of IP / CIDR / keyword strings accepted by
 * `proxy-addr`:
 *   - `loopback`        — 127.0.0.1/8, ::1
 *   - `linklocal`       — 169.254.0.0/16, fe80::/10
 *   - `uniquelocal`     — RFC 1918 private + fc00::/7
 *   - any IP or CIDR    — `10.0.0.5`, `192.168.0.0/16`, `2001:db8::/32`
 *
 * When `X-Forwarded-For` is missing or fully trusted (e.g. local dev
 * requests), proxy-addr falls back to the synthetic loopback peer;
 * we then try `X-Real-IP` before giving up and returning `'unknown'`.
 */
export function getClientIp(headers: Headers, trusted: string[]): string {
  // Convex HTTP actions don't expose the TCP peer address. We synthesize
  // a minimal IncomingMessage-shaped object with a loopback peer — it's
  // always trusted, so proxy-addr will only return it when no
  // X-Forwarded-For information is available.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- proxy-addr's typings require IncomingMessage, but it only reads `socket.remoteAddress` and `headers['x-forwarded-for']` off it. Matching the full Node http type is neither possible nor needed here.
  const req = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      'x-forwarded-for': headers.get('x-forwarded-for') ?? '',
    },
  } as unknown as IncomingMessage;

  try {
    const addr = proxyaddr(req, trusted);
    if (addr && addr !== '127.0.0.1') return addr;
    const real = headers.get('x-real-ip')?.trim();
    return real || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Load the trusted-proxy list from the `default` org's login policy,
 * falling back to the built-in defaults. Deployments self-configure
 * this from Settings → Governance → Login policy; there is no env var.
 */
export async function loadTrustedProxies(
  ctx: MutationCtx | ActionCtx,
): Promise<string[]> {
  return ctx.runQuery(
    internal.login_attempts.internal_queries.getTrustedProxies,
    {},
  );
}

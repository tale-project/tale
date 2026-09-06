import type { IncomingMessage } from 'node:http';
import { isIPv4 } from 'node:net';

import proxyaddr from 'proxy-addr';

/** The peer stood in for callers that cannot see the TCP socket. */
const SYNTHETIC_LOOPBACK_PEER = '127.0.0.1';

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
 * `opts.peer` is the TCP peer that delivered the request when the runtime
 * exposes it (`nodePeerAddress`). The walk starts THERE: a peer no trusted
 * entry claims IS the client, and whatever `X-Forwarded-For` / `X-Real-IP`
 * it sent is its own claim, never consulted — so a backend reached without
 * the deployment's proxy cannot be fed a forged chain. Without a peer the
 * walk starts from a synthetic loopback hop (the only option where the
 * socket is invisible), which trusts the forwarded chain as far as the
 * trusted list allows.
 *
 * When the chain is missing or fully trusted (e.g. local dev requests), the
 * walk ends on the peer; we then try `X-Real-IP` before giving up and
 * returning `'unknown'`.
 */
export function getClientIp(
  headers: Headers,
  trusted: string[],
  opts: { peer?: string | undefined } = {},
): string {
  const peer =
    opts.peer === undefined
      ? SYNTHETIC_LOOPBACK_PEER
      : normalizePeerAddress(opts.peer);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- proxy-addr's typings require IncomingMessage, but it only reads `socket.remoteAddress` and `headers['x-forwarded-for']` off it. Matching the full Node http type is neither possible nor needed here.
  const req = {
    socket: { remoteAddress: peer },
    headers: {
      'x-forwarded-for': headers.get('x-forwarded-for') ?? '',
    },
  } as unknown as IncomingMessage;

  try {
    const addr = proxyaddr(req, trusted);
    // The walk stopped on a forwarded hop no trusted proxy claims: the client.
    if (addr && addr !== peer) return addr;
    // A REAL peer nothing trusts is the client itself — its headers are
    // untrusted input, not routing information.
    if (opts.peer !== undefined && !proxyaddr.compile(trusted)(peer, 0)) {
      return peer;
    }
    // A trusted proxy that forwarded no usable chain: its X-Real-IP, if any.
    const real = headers.get('x-real-ip')?.trim();
    return real || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Node reports IPv4 peers on a dual-stack socket as IPv4-mapped IPv6
 * (`::ffff:203.0.113.5`); the forwarded chain spells the same client
 * `203.0.113.5`. One spelling, so the two never key separate buckets.
 */
function normalizePeerAddress(peer: string): string {
  const mapped = /^::ffff:(?<v4>.+)$/i.exec(peer)?.groups?.v4;
  return mapped !== undefined && isIPv4(mapped) ? mapped : peer;
}

/**
 * The TCP peer `@hono/node-server` exposes to a route as
 * `c.env.incoming.socket.remoteAddress` — read defensively so a runtime
 * without that binding (tests via `app.request`, another adapter) simply
 * yields `undefined` and `getClientIp` falls back to its synthetic hop.
 */
export function nodePeerAddress(env: unknown): string | undefined {
  if (env === null || typeof env !== 'object') return undefined;
  const incoming: unknown = Reflect.get(env, 'incoming');
  if (incoming === null || typeof incoming !== 'object') return undefined;
  const socket: unknown = Reflect.get(incoming, 'socket');
  if (socket === null || typeof socket !== 'object') return undefined;
  const address: unknown = Reflect.get(socket, 'remoteAddress');
  return typeof address === 'string' && address !== '' ? address : undefined;
}

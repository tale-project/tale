// What a device's sessions may reach on the platform, and how headers cross
// the tunnel.
//
// A session on a device calls the same addresses a session on the server
// does — `http://backend-api:3005` and `http://sandbox-llm-gateway:8080` —
// because the device's spawner answers those names on the device's sandbox
// network and relays each request through the tunnel. The hub then sends it to
// the real service, but only along the paths sessions actually use: the
// backend's three in-sandbox doors (each authenticated by a per-session token)
// and the gateway's inference routes (authenticated by the session's virtual
// key). The gateway's management API shares its port and is never relayed.

import type { HeaderList } from './tunnel.ts';

export const RELAY_NAMES = ['api', 'gateway'] as const;
export type RelayName = (typeof RELAY_NAMES)[number];

export function isRelayName(value: unknown): value is RelayName {
  return value === 'api' || value === 'gateway';
}

/** A relay as the platform announces it: the URL its sessions are handed. */
export interface RelayTarget {
  name: RelayName;
  url: string;
}

const RELAY_PATH_PREFIXES: Record<RelayName, readonly string[]> = {
  api: ['/api/tools', '/api/connectors', '/api/sandbox-blob'],
  gateway: ['/openai/', '/anthropic/', '/genai/'],
};

/** The methods a session's HTTP clients send to these doors. */
const RELAY_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

export function relayMethodAllowed(method: string): boolean {
  return RELAY_METHODS.has(method);
}

const PARSE_BASE = 'http://relay.invalid';

// A percent escape a router may decode before matching, into a character that
// changes where the request lands: `#` `%` `.` `/` `?` `\` and the control
// characters.
const STEERING_ESCAPE = /%(?:2[35eEfF]|3[fF]|5[cC]|7[fF]|[01][0-9a-fA-F])/;

/**
 * The exact path (with query) to send upstream for a device's session through
 * `relay`, or null when it may not pass. The path must already be canonical:
 * anything a URL parser or the upstream's router would rewrite — control
 * characters (which a parser silently drops, so `/.\t./` would become `/../`
 * AFTER this check), backslashes, dot segments, a second leading slash, a
 * fragment, escapes that decode to a separator — is refused rather than
 * normalized, so the prefix test judges the very path the upstream routes. A
 * prefix must end the path or be followed by `/`, so `/api/toolsx` is not
 * `/api/tools`.
 */
export function relayPath(relay: RelayName, path: string): string | null {
  if (
    !/^[\x21-\x7e]+$/.test(path) ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    path.includes('#') ||
    !URL.canParse(path, PARSE_BASE)
  ) {
    return null;
  }
  const url = new URL(path, PARSE_BASE);
  const pathname = url.pathname;
  if (
    url.origin !== PARSE_BASE ||
    pathname !== path.split('?', 1)[0] ||
    STEERING_ESCAPE.test(pathname)
  ) {
    return null;
  }
  const allowed = RELAY_PATH_PREFIXES[relay].some((prefix) => {
    if (prefix.endsWith('/')) return pathname.startsWith(prefix);
    if (!pathname.startsWith(prefix)) return false;
    const next = pathname.charAt(prefix.length);
    return next === '' || next === '/';
  });
  return allowed ? pathname + url.search : null;
}

/** May a device's session reach `path` (with query) through `relay`? */
export function relayAllows(relay: RelayName, path: string): boolean {
  return relayPath(relay, path) !== null;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  // Recomputed by whoever re-sends the body; a stale length would truncate or
  // hang a streamed body.
  'content-length',
]);

/** Headers that may cross the tunnel: everything but hop-by-hop fields and the
 * spawner's own signing/attribution headers (a device never forges those). */
export function forwardableHeaders(headers: Headers | HeaderList): HeaderList {
  const entries: Iterable<[string, string]> =
    headers instanceof Headers ? headers.entries() : headers;
  const out: HeaderList = [];
  for (const [rawName, value] of entries) {
    const name = rawName.toLowerCase();
    if (HOP_BY_HOP.has(name) || name.startsWith('x-tale-sandbox-')) continue;
    out.push([name, value]);
  }
  return out;
}

// Who the caller is, as a proxy would claim it: a relayed request comes from
// the hub, and the device may not speak for the client address (the backend
// trusts these from private networks) or bring a browser's cookies.
const CLIENT_CLAIMS = new Set([
  'cookie',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-prefix',
  'x-forwarded-proto',
  'x-real-ip',
  'x-client-ip',
  'true-client-ip',
  'cf-connecting-ip',
]);

/** The headers of a device's session request the hub sends upstream. */
export function relayRequestHeaders(headers: HeaderList): HeaderList {
  return forwardableHeaders(headers).filter(
    ([name]) => !CLIENT_CLAIMS.has(name),
  );
}

export function toHeaders(list: HeaderList): Headers {
  const headers = new Headers();
  for (const [name, value] of list) headers.append(name, value);
  return headers;
}

/** The host name and port a relay URL addresses — what a device answers on. */
export function relayEndpoint(url: string): { hostname: string; port: number } {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:') {
    throw new Error(
      `relay ${url} must be a plain http:// URL on the sandbox network`,
    );
  }
  const port = parsed.port === '' ? 80 : Number(parsed.port);
  return { hostname: parsed.hostname, port };
}

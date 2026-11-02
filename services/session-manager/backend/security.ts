// Protection against other websites open in the user's browser: the app has no
// login, so any page that can reach 127.0.0.1 could use it.
//
// - The Host header must be one of the app's own addresses: defeats DNS
//   rebinding.
// - A state-changing request must not carry a foreign Origin, and a body must
//   be JSON: defeats CSRF (a cross-site form can only send form encodings or
//   text/plain without a CORS preflight).
// - A browser says who started a request in `Sec-Fetch-Site`: the data of the
//   app (`/api`, `/mcp`) is only for the page itself (`same-origin`) and for
//   the person (`none`: the address bar, a bookmark). Another site, or another
//   origin of this computer (`cross-site`, `same-site`), is refused whatever
//   the method: a page that may not read an answer can still make the browser
//   fetch it, and a download of the proxy passwords would be saved to the disk.
//   A program sends no such header and is not asked.
// - A WebSocket handshake gets the same checks (the middleware does not see
//   those): any page may open a socket, and the same-origin policy does not
//   stop it.

import type { MiddlewareHandler } from 'hono';

const UNSAFE_METHODS: ReadonlySet<string> = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

/** What the checks read of a request: a `Headers`, or anything shaped like one. */
export type HeaderReader = Pick<Headers, 'get'>;

/** A refused request: the stable code and the sentence it is answered with. */
export interface Refusal {
  code: 'forbidden_host' | 'forbidden_origin';
  message: string;
}

/** Who started a request, as a browser says it, when it is one the data of the app is for. */
const OWN_FETCH_SITES: ReadonlySet<string> = new Set(['same-origin', 'none']);

/**
 * Whether the request was started by the page itself or by the person, or by
 * a program that sends no `Sec-Fetch-Site`. Anything else is refused,
 * including a value no browser sends.
 */
function fetchSiteAllowed(headers: HeaderReader): boolean {
  const site = headers.get('sec-fetch-site');
  return site === null || OWN_FETCH_SITES.has(site.trim().toLowerCase());
}

/** The Host header as the allowed hosts are written: lowercase. */
function hostOf(headers: HeaderReader): string {
  return (headers.get('host') ?? '').toLowerCase();
}

/**
 * Whether the client reached the app over TLS: Bun terminates it itself
 * (`secure`: the URL says https), or a proxy in front does and says so in
 * `X-Forwarded-Proto` (Bun then only sees plain HTTP). Trusting that header
 * gives a foreign site nothing: its page cannot send it without a CORS
 * preflight, which the app never grants, and a socket handshake cannot carry
 * it at all.
 */
function cameOverTls(headers: HeaderReader, secure: boolean): boolean {
  if (secure) return true;
  const forwarded = headers.get('x-forwarded-proto');
  return forwarded?.split(',')[0]?.trim().toLowerCase() === 'https';
}

/** The page of the app itself: `http://<host>`, `https://<host>` over TLS. */
function isOwnOrigin(origin: string, host: string, tls: boolean): boolean {
  return origin === `http://${host}` || (tls && origin === `https://${host}`);
}

// Shared by every refusal: frozen, so that no caller changes the sentence of the next one.
const FOREIGN_HOST: Refusal = Object.freeze({
  code: 'forbidden_host',
  message: 'Requests must address the app as 127.0.0.1 or localhost.',
});
const FOREIGN_ORIGIN: Refusal = Object.freeze({
  code: 'forbidden_origin',
  message: 'Cross-site requests are not allowed.',
});

/**
 * Why a WebSocket handshake is refused, or null when it comes from the app's
 * own page or from a program (which sends no Origin). The host is judged
 * first, as for every other request. `secure`: the caller knows the socket
 * itself is TLS; a TLS proxy in front is told by `X-Forwarded-Proto`.
 */
export function websocketRefusal(
  headers: HeaderReader,
  hosts: ReadonlySet<string>,
  secure = false,
): Refusal | null {
  const host = hostOf(headers);
  if (!hosts.has(host)) return FOREIGN_HOST;
  const origin = headers.get('origin');
  const ownOrigin =
    origin === null || isOwnOrigin(origin, host, cameOverTls(headers, secure));
  return fetchSiteAllowed(headers) && ownOrigin ? null : FOREIGN_ORIGIN;
}

function hasBody(request: Request): boolean {
  const length = request.headers.get('content-length');
  return (
    request.body !== null ||
    (length !== null && length !== '0') ||
    request.headers.has('transfer-encoding')
  );
}

function mediaType(headers: HeaderReader): string {
  const value = headers.get('content-type') ?? '';
  return (value.split(';', 1)[0] ?? '').trim().toLowerCase();
}

/**
 * Why a request is refused, or null. A request answers to the app's own
 * addresses only; one for the data of the app (`api`, the default) must not
 * come from another site, and one that changes something must not come from
 * another origin and must send JSON if it sends a body. The files of the
 * page itself (`page`) are for anyone who knows the address: a link on another
 * site may open it.
 */
export function requestRefusal(
  request: Request,
  hosts: ReadonlySet<string>,
  area: 'api' | 'page' = 'api',
): Refusal | null {
  const host = hostOf(request.headers);
  if (!hosts.has(host)) return FOREIGN_HOST;
  if (area === 'api' && !fetchSiteAllowed(request.headers)) {
    return FOREIGN_ORIGIN;
  }
  if (!UNSAFE_METHODS.has(request.method)) return null;
  const origin = request.headers.get('origin');
  const tls = cameOverTls(request.headers, request.url.startsWith('https:'));
  if (origin !== null && !isOwnOrigin(origin, host, tls)) return FOREIGN_ORIGIN;
  if (hasBody(request) && mediaType(request.headers) !== 'application/json') {
    return {
      code: 'forbidden_origin',
      message: 'Request bodies must be sent as application/json.',
    };
  }
  return null;
}

/** The middleware that answers `{ error, message }` 403 to a refused request. */
export function localOnly(hosts: ReadonlySet<string>): MiddlewareHandler {
  return async (c, next) => {
    const refusal = requestRefusal(c.req.raw, hosts);
    if (refusal === null) return next();
    return c.json({ error: refusal.code, message: refusal.message }, 403);
  };
}

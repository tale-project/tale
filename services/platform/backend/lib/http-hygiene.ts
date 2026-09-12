import {
  ServerResponse,
  type IncomingMessage,
  type OutgoingHttpHeader,
  type OutgoingHttpHeaders,
} from 'node:http';

import type { Context, Env, MiddlewareHandler, NotFoundHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { getPath } from 'hono/utils/url';

/**
 * The request-level hygiene every backend response shares, independent of
 * which door answers: the NUL-byte refusal, the JSON 404 for the API
 * prefix, and the transport-security headers. Kept apart from `app.ts` so
 * each rule is a unit under test rather than a line inside the wiring.
 */

/**
 * A NUL in a URL is never a valid path segment or query value here, and
 * Postgres refuses it in every text column (`22021`) — a `GET /documents/
 * a%00b` used to reach the driver and answer a text/plain 500. Refused as
 * the client mistake it is, before any door decodes it into a lookup.
 */
export function nulUrlGuard<E extends Env>(): MiddlewareHandler<E> {
  return async (c, next) => {
    if (/%00/i.test(c.req.url) || c.req.path.includes('\0')) {
      return c.json(
        {
          error: 'The request URL contains a NUL character (U+0000)',
          code: 'INVALID_URL',
        },
        400,
      );
    }
    return next();
  };
}

/**
 * The api-key plugin turns a key found in its configured header into the
 * key holder's session for WHATEVER endpoint the request reaches — that is
 * how the REST door verifies a bearer key (it hands the key over on a
 * synthetic request it builds itself, rest/v1.ts). Read from a client, the
 * same header made a leaked REST key a full browser session: it minted
 * further keys on the auth mount, opened every session-gated app route and
 * the event stream, and none of the door's own rules (the organization
 * header, the role gates, the key holder's budget) applied. No client is
 * meant to send it, so its presence is refused outright — before the auth
 * mount, the app door or any other route sees the request.
 */
export function apiKeyHeaderGuard<E extends Env>(
  headerNames: readonly string[],
): MiddlewareHandler<E> {
  return async (c, next) => {
    const present = headerNames.find(
      (name) => c.req.header(name) !== undefined,
    );
    if (present !== undefined) {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json(
        {
          error: `The "${present}" header is not accepted — send an API key as "Authorization: Bearer <key>" to the REST API under /api/v1`,
          code: 'UNAUTHORIZED',
        },
        401,
      );
    }
    return next();
  };
}

/**
 * A path nobody serves under `/api/` answers the JSON envelope every API
 * door documents, never Hono's text/plain default — a mistyped prefix
 * (`/api/v2/…`) or an unrouted app path still speaks the contract. Other
 * paths keep the framework's plain 404.
 */
export const apiNotFound: NotFoundHandler = (c: Context) =>
  c.req.path.startsWith('/api/')
    ? // Uncacheable like every other API answer — a route miss cached by
      // an intermediary would outlive the deploy that adds the route.
      c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404, {
        'cache-control': 'no-store',
      })
    : c.text('404 Not Found', 404);

/** The request target as the wire carried it: the Node adapter hands the
 * raw `IncomingMessage` in as the environment, whose `url` is the exact
 * bytes of the request line; any other host falls back to the parsed
 * path and query. */
function requestTarget(c: Context): string {
  const incoming: unknown = Reflect.get(c.env ?? {}, 'incoming');
  const raw =
    incoming !== null && typeof incoming === 'object'
      ? Reflect.get(incoming, 'url')
      : undefined;
  if (typeof raw === 'string') return raw;
  const url = new URL(c.req.url);
  return `${url.pathname}${url.search}`;
}

/** The URL budget the contract documents: path and query together. */
export const MAX_REQUEST_URI_BYTES = 32 * 1024;

/**
 * A request URL past the budget answers **414** in the envelope, before
 * any route is looked up — the refusal the API reference promised for an
 * over-long URL. It used to be left to the edge, whose header cap is Go's:
 * over HTTP/1.1 the same URL slipped through to the route (the reader
 * allows a few KiB of slack), and over HTTP/2 one field past the cap ends
 * the connection with no response at all, so a client saw a network fault
 * and retried a request that could never succeed. The edge now keeps a
 * higher cap and answers the same 414 on its own lane.
 */
export function uriLengthGuard<E extends Env>(
  maxBytes: number = MAX_REQUEST_URI_BYTES,
): MiddlewareHandler<E> {
  return async (c, next) => {
    if (Buffer.byteLength(requestTarget(c)) > maxBytes) {
      return c.json(
        {
          error: `The request URL exceeds ${maxBytes / 1024} KiB (path and query)`,
          code: 'URI_TOO_LONG',
        },
        414,
        { 'cache-control': 'no-store' },
      );
    }
    return next();
  };
}

/**
 * Hono routes strictly, so `GET /api/v1/contacts/` answered the door's 404
 * while `/api/v1/contacts` was served — and clients that normalise paths
 * with a trailing slash (several HTTP libraries do by configuration)
 * failed on every call with a key and a path that both looked right. One
 * trailing slash under `/api/v1/` is dropped before routing; the prefix
 * itself and a doubled slash stay what they are. Installed as the root
 * app's `getPath`, so `c.req.path` — the value the door's method probe
 * reads — agrees with what was routed.
 */
export function apiPathWithoutTrailingSlash(request: Request): string {
  const path = getPath(request);
  return path.length > '/api/v1/'.length &&
    path.startsWith('/api/v1/') &&
    path.endsWith('/') &&
    !path.endsWith('//')
    ? path.slice(0, -1)
    : path;
}

const BODILESS_HEADERS = new Set([
  'content-type',
  'content-length',
  'transfer-encoding',
]);

/**
 * The Node HTTP adapter stamps `content-type: text/plain; charset=UTF-8`
 * on every response that names no type — a 204 and a bodiless 202
 * included, where RFC 9110 §6.4.1 says there is no content to describe
 * and strict clients and linting proxies complain. The adapter builds the
 * header set after the app has answered, so no middleware can remove it;
 * the server's response class can. Installed through `serverOptions`
 * (main.ts), which the adapter hands to `http.createServer` verbatim.
 */
export class BodilessAwareResponse<
  Request extends IncomingMessage = IncomingMessage,
> extends ServerResponse<Request> {
  override writeHead(
    statusCode: number,
    reasonOrHeaders?: string | OutgoingHttpHeaders | OutgoingHttpHeader[],
    maybeHeaders?: OutgoingHttpHeaders | OutgoingHttpHeader[],
  ): this {
    const reason =
      typeof reasonOrHeaders === 'string' ? reasonOrHeaders : undefined;
    let headers =
      typeof reasonOrHeaders === 'string' ? maybeHeaders : reasonOrHeaders;
    if (statusCode === 204 || statusCode === 304) {
      for (const name of BODILESS_HEADERS) this.removeHeader(name);
      if (Array.isArray(headers)) {
        // The raw form: a flat `[name, value, name, value, …]` list.
        const kept: OutgoingHttpHeader[] = [];
        for (let i = 0; i + 1 < headers.length; i += 2) {
          const name = headers[i];
          const value = headers[i + 1];
          if (name === undefined || value === undefined) continue;
          if (
            typeof name === 'string' &&
            BODILESS_HEADERS.has(name.toLowerCase())
          ) {
            continue;
          }
          kept.push(name, value);
        }
        headers = kept;
      } else if (headers !== undefined) {
        headers = Object.fromEntries(
          Object.entries(headers).filter(
            ([name]) => !BODILESS_HEADERS.has(name.toLowerCase()),
          ),
        );
      }
    }
    return reason === undefined
      ? super.writeHead(statusCode, headers)
      : super.writeHead(statusCode, reason, headers);
  }
}

/**
 * The transport-security headers every backend response carries — the
 * proxy delegates them to the app tier, which never sees `/api/*`. No CSP
 * (these are JSON, XML and blob responses, not documents) and the
 * cross-origin isolation defaults off, as on the app's WebDAV variant:
 * OAuth callbacks and SSO hand-offs render in popups and top-level
 * navigations that COOP/CORP would break. HSTS only when the deployment is
 * served over https — a plain-http dev origin must not pin browsers.
 */
export function backendSecureHeaders<E extends Env>(
  siteUrl: string | undefined,
): MiddlewareHandler<E> {
  return secureHeaders({
    strictTransportSecurity: (siteUrl ?? '').startsWith('https://')
      ? 'max-age=15552000'
      : false,
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  });
}

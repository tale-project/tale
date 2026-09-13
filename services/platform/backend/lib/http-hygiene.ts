import { randomUUID } from 'node:crypto';
import {
  maxHeaderSize as processHeaderBudget,
  Server,
  ServerResponse,
  type IncomingMessage,
  type OutgoingHttpHeader,
  type OutgoingHttpHeaders,
} from 'node:http';
import type { Socket } from 'node:net';

import type { ServerType } from '@hono/node-server';
import type { Context, Env, MiddlewareHandler, NotFoundHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { getPath } from 'hono/utils/url';

import { API_CONTRACT_VERSION } from '../../lib/shared/constants/api-contract.ts';
import { requestIdOf } from '../error-reporting.ts';

/**
 * The request-level hygiene every backend response shares, independent of
 * which door answers: the NUL-byte refusal, the JSON 404 for the API
 * prefix, the REST door's contract headers, and the transport-security
 * headers. Kept apart from `app.ts` so each rule is a unit under test
 * rather than a line inside the wiring.
 */

/** `Cache-Control: no-store` where the answer chose no directive of its
 * own — the store half of the caching contract. */
function defaultToNoStore(headers: Headers): void {
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
}

/**
 * Every answer on a machine door is per-caller and per-moment — a key
 * holder's own rows, a webhook's verdict, a turn's state — so nothing
 * between the caller and the door may cache it. Routes that set their own
 * directive (a validated read's `private, no-cache`, the attachment lane's
 * `private, no-store`) keep it. One helper for the three doors that stamp
 * it (the REST door inside and outside its families, the webhook door), so
 * the default cannot drift between them.
 */
export function noStoreByDefault<E extends Env>(): MiddlewareHandler<E> {
  return async (c, next) => {
    await next();
    defaultToNoStore(c.res.headers);
  };
}

/**
 * What every `/api/v1` answer carries, a pre-route refusal and the
 * catch-all's included: the contract version a client can pin to
 * (`X-Tale-Api-Version`), `no-store` where no route chose a directive,
 * and — for a HEAD — the `Content-Length` a GET would have carried. Hono
 * answers HEAD by running the GET handler and dropping the body
 * afterwards, so the adapter never learns the length; a JSON body is
 * buffered here and measured, which is what a client that sizes a page
 * before fetching it is asking for. Mounted on `/api/v1/*` by `createApp`
 * AHEAD of the guards below: the stamper used to live inside the door,
 * behind them, so the x-api-key 401, the 414 and the NUL 400 reached a
 * client with neither header — and a monitor keyed on the version header
 * misfired on exactly the refusals it should have read.
 */
export function restDoorHeaders<E extends Env>(): MiddlewareHandler<E> {
  return async (c, next) => {
    await next();
    c.res.headers.set('x-tale-api-version', API_CONTRACT_VERSION);
    defaultToNoStore(c.res.headers);
    if (
      c.req.method === 'HEAD' &&
      c.res.body !== null &&
      !c.res.headers.has('content-length') &&
      (c.res.headers.get('content-type') ?? '').includes('application/json')
    ) {
      const bytes = await c.res.arrayBuffer();
      const measured = new Response(bytes, c.res);
      measured.headers.set('content-length', String(bytes.byteLength));
      c.res = measured;
    }
  };
}

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
 * and retried a request that could never succeed. This guard is the ONE
 * producer of the 414: the edge answered a twin of it for a while, from a
 * literal body that carried neither the `requestId` nor the contract
 * version (the proxy image has no `API_CONTRACT_VERSION`) and counted code
 * points rather than bytes — one source of truth beats a constant copied
 * into a second image. The edge keeps only its 64 KiB header budget as the
 * cliff, well above this cap. The body repeats the request id the way the
 * 413 and the 500 do, so a caller can quote it from the envelope.
 */
export function uriLengthGuard<E extends Env>(
  maxBytes: number = MAX_REQUEST_URI_BYTES,
): MiddlewareHandler<E> {
  return async (c, next) => {
    if (Buffer.byteLength(requestTarget(c)) > maxBytes) {
      const requestId = requestIdOf(c);
      return c.json(
        {
          error: `The request URL exceeds ${maxBytes / 1024} KiB (path and query)`,
          code: 'URI_TOO_LONG',
          ...(requestId === undefined ? {} : { requestId }),
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

/** A 416 on this server never carries a body — the document lane answers
 * it with `Content-Length: 0` and the `Content-Range` that names the size
 * — so the adapter's default `text/plain` must not describe one; the
 * length and the range stay, they ARE the answer (the store's own 416 once
 * reached the edge with the length of an XML body that never came, and
 * the edge aborted the stream on that promise). */
const UNSATISFIABLE_HEADERS: ReadonlySet<string> = new Set([
  'content-type',
  'transfer-encoding',
]);

/** The content headers a status must not carry on this server, or null
 * when the status describes a body. */
function bodilessHeadersFor(statusCode: number): ReadonlySet<string> | null {
  if (statusCode === 204 || statusCode === 304) return BODILESS_HEADERS;
  if (statusCode === 416) return UNSATISFIABLE_HEADERS;
  return null;
}

/**
 * The Node HTTP adapter stamps `content-type: text/plain; charset=UTF-8`
 * on every response that names no type — a 204 and a bodiless 202
 * included, where RFC 9110 §6.4.1 says there is no content to describe
 * and strict clients and linting proxies complain — and on the bodiless
 * 416 the document lane answers (§15.5.17: the range could not be
 * satisfied; `Content-Range` names the size, `Content-Length` is 0). The adapter builds the
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
    const drop = bodilessHeadersFor(statusCode);
    if (drop !== null) {
      for (const name of drop) this.removeHeader(name);
      if (Array.isArray(headers)) {
        // The raw form: a flat `[name, value, name, value, …]` list.
        const kept: OutgoingHttpHeader[] = [];
        for (let i = 0; i + 1 < headers.length; i += 2) {
          const name = headers[i];
          const value = headers[i + 1];
          if (name === undefined || value === undefined) continue;
          if (typeof name === 'string' && drop.has(name.toLowerCase())) {
            continue;
          }
          kept.push(name, value);
        }
        headers = kept;
      } else if (headers !== undefined) {
        headers = Object.fromEntries(
          Object.entries(headers).filter(
            ([name]) => !drop.has(name.toLowerCase()),
          ),
        );
      }
    }
    return reason === undefined
      ? super.writeHead(statusCode, headers)
      : super.writeHead(statusCode, reason, headers);
  }
}

/** How many header bytes the door reads before answering: Node's 16 KiB
 * default counts the request target too, and its overflow answer is a
 * bare 431 with the socket destroyed — which the proxy turned into a
 * reset stream. The proxy budgets 64 KiB of headers and Go's HTTP/1.1
 * reader lets a few KiB past that through, so this cap sits ABOVE the
 * proxy's plus that slack: everything the edge forwards is answered by
 * the door (a URL over 32 KiB with its own 414), never by a bare 431. */
export const MAX_REQUEST_HEADER_BYTES = 80 * 1024;

/**
 * How long a request has to finish ARRIVING — headers and body together —
 * before the listener gives up on it (Node's `requestTimeout`). Derived
 * from the caps the contract documents rather than left at Node's 5-minute
 * default, which cut a 30.5 MB staged upload off at 10.8 MB on a 34 KB/s
 * link — inside the documented 30 MiB budget, so the client had done
 * nothing wrong: the largest body the door reads is the 32 MiB inline
 * document, and 15 minutes admits it (and the 30 MiB staged upload) at
 * roughly 35 KB/s — a slow mobile or corporate link, still — while the
 * edge's 64 MB backstop and the per-route caps bound what the wait can
 * buffer. The header phase keeps Node's 60 s (`headersTimeout`, which Node
 * requires to stay at or below this).
 */
export const MAX_REQUEST_ARRIVAL_MS = 15 * 60_000;

/** The `http.createServer` options every backend listener runs with — the
 * production door (main.ts) and the integration harness alike, so what
 * the harness proves on the wire is what the deployment sends. */
export const BACKEND_SERVER_OPTIONS = {
  maxHeaderSize: MAX_REQUEST_HEADER_BYTES,
  headersTimeout: 60_000,
  requestTimeout: MAX_REQUEST_ARRIVAL_MS,
  ServerResponse: BodilessAwareResponse,
} as const;

/** A duration in the unit a person reads: whole minutes, else seconds. */
function describeDuration(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    const minutes = ms / 60_000;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const seconds = ms / 1000;
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

/** The header budget a listener enforces: its own `maxHeaderSize` option
 * (set on the instance, but not in Node's typings), else the process's. */
function headerBudgetOf(server: Server): number {
  const own: unknown = Reflect.get(server, 'maxHeaderSize');
  return typeof own === 'number' ? own : processHeaderBudget;
}

/** The status, reason phrase and envelope a listener-level failure gets. */
function clientErrorRefusal(
  error: NodeJS.ErrnoException,
  server: Server,
): { status: number; reason: string; code: string; error: string } {
  switch (error.code) {
    case 'ERR_HTTP_REQUEST_TIMEOUT':
      return {
        status: 408,
        reason: 'Request Timeout',
        code: 'REQUEST_TIMEOUT',
        error: `The request did not finish arriving within ${describeDuration(server.requestTimeout)} (headers and body together); the connection is closed — send the body on a faster link or in smaller pieces`,
      };
    case 'HPE_HEADER_OVERFLOW':
      return {
        status: 431,
        reason: 'Request Header Fields Too Large',
        code: 'HTTP_ERROR',
        error: `The request headers exceed ${headerBudgetOf(server) / 1024} KiB; the connection is closed — carry data in the body, never in a header`,
      };
    default:
      return {
        status: 400,
        reason: 'Bad Request',
        code: 'HTTP_ERROR',
        error: `The request could not be read as HTTP (${error.code ?? 'malformed'}); the connection is closed`,
      };
  }
}

/**
 * The refusals the listener answers BELOW the app — Node's `clientError`:
 * a body that stops arriving (`requestTimeout`), a header block past the
 * budget, bytes that are not HTTP — in the JSON envelope every door speaks,
 * instead of Node's default bare `408 Request Timeout` / `431` / `400`
 * status line: a client that timed out inside the documented upload budget
 * got a response with no `code` to branch on and no request id to quote,
 * indistinguishable from a network fault. There is no request or response
 * object at this layer, so the answer is written to the socket raw, with a
 * fresh id (the in-flight request's own is not reachable here — the same
 * convention as the edge's own refusals) and the contract version.
 *
 * Written only when the socket can still take a well-formed response: not
 * on a reset peer, not on an unwritable socket, and never over a response
 * whose headers already went out — that is Node's own rule. It is NOT
 * `socket.bytesWritten === 0`: the proxy pools keep-alive connections to
 * this listener, so nearly every socket a timeout hits already served a
 * request, and that rule would have skipped the envelope exactly where it
 * matters (a destroyed upstream socket is a 502 at the edge, worse than
 * the bare 408 it replaces). The in-flight response is tracked from the
 * `request` event, which the adapter's own listener does not expose.
 * Installed after `serve()` (main.ts, the integration harness); an HTTP/2
 * flavour of the server, which raises no `clientError`, is left alone.
 */
export function installClientErrorEnvelope(server: ServerType): void {
  if (!(server instanceof Server)) return;
  const inFlight = new WeakMap<Socket, ServerResponse>();
  server.on('request', (request, response) => {
    inFlight.set(request.socket, response);
    response.once('close', () => {
      if (inFlight.get(request.socket) === response) {
        inFlight.delete(request.socket);
      }
    });
  });
  server.on('clientError', (error: NodeJS.ErrnoException, socket: Socket) => {
    const current = inFlight.get(socket);
    if (
      error.code === 'ECONNRESET' ||
      socket.destroyed ||
      !socket.writable ||
      current?.headersSent === true
    ) {
      socket.destroy(error);
      return;
    }
    const refusal = clientErrorRefusal(error, server);
    const requestId = randomUUID();
    const body = JSON.stringify({
      error: refusal.error,
      code: refusal.code,
      requestId,
    });
    const response = [
      `HTTP/1.1 ${refusal.status} ${refusal.reason}`,
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(body)}`,
      'Cache-Control: no-store',
      `X-Request-Id: ${requestId}`,
      `X-Tale-Api-Version: ${API_CONTRACT_VERSION}`,
      'Connection: close',
      '',
      body,
    ].join('\r\n');
    // Destroyed once the answer has left for the kernel — `destroy` right
    // after `write` can drop what is still queued — and destroyed even if
    // the write itself failed: nothing more is read from this connection.
    socket.write(response, () => socket.destroy(error));
  });
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

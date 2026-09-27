import * as Sentry from '@sentry/node';
import type { Context, ErrorHandler } from 'hono';

import {
  databaseUnavailableCause,
  describeDatabaseError,
  type DatabaseErrorOrigin,
} from './db/unavailable.ts';
import { routeClass } from './telemetry.ts';

/**
 * Sentry-compatible error reporting for the 0.5 backend (api + worker roles).
 *
 * Opt-in via `SENTRY_DSN`, exactly like the browser SPA: unset means every
 * function here is a no-op and the SDK never initializes. The DSN already
 * reaches the backend containers (both compose lanes mount `env_file: .env`);
 * this module is what makes the process honor it.
 *
 * Errors only, deliberately: this module sets no `tracesSampleRate`, and
 * nothing outbound is ours to trace.
 *
 * `tracePropagationTargets: []` because the SDK otherwise stamps
 * `sentry-trace` and `baggage` — release, public key, environment — onto
 * every outgoing `fetch`, tracing sampled or not: the crawler carried them
 * to every third-party site it visited (2026-09-15 evaluation, i6).
 *
 * `spans: false` on the http and fetch integrations, because the empty
 * target list alone did not hold on the wire (2026-09-18 evaluation, J6-1).
 * The SDK reads `SENTRY_TRACES_SAMPLE_RATE` from the environment, and the
 * deployment's shared env file carries the browser's value into these
 * containers (the CLI writes it, `'0'` by default). Any value switches span
 * recording on; with it the integrations register OpenTelemetry's request
 * instrumentation beside their own, and its propagator derives the target
 * URL from the active span — an unsampled span records no URL, so the
 * target list is never consulted and the headers go out anyway. `spans:
 * false` keeps the request lanes on the Sentry-native hooks (breadcrumbs,
 * request isolation), which honour the target list on every request.
 *
 * `registerEsmLoaderHooks: false` because the backend already runs under its
 * own resolve hook (`node-loader.mjs`); stacking import-in-the-middle's
 * loader onto that chain buys nothing without tracing and risks resolver
 * interplay.
 *
 * The unhandled-rejection integration is pinned to `mode: 'strict'`: any
 * `unhandledRejection` listener suppresses Node's default crash, and the
 * SDK's default `warn` mode would silently convert today's crash-and-restart
 * semantics into limp-along. Strict captures the event and then exits the
 * way plain Node 22 does.
 *
 * No credential leaves with an event. The SDK's request-data integration
 * sends the incoming request's headers, cookies and body whatever
 * `sendDefaultPii` says, and the server integration captures the body too,
 * so every 500 on an authenticated route used to carry the caller's session
 * cookie, Bearer key or sign-in body to the error tracker (2026-09-27: the
 * VAT plus workers' live API keys were found stored there). Bodies are never
 * captured (`maxIncomingRequestBodySize: 'none'`), and `scrubEvent` drops
 * cookies and any body, masks credential headers, credential path segments
 * (webhook and share tokens) and credential query values before an event is
 * sent — breadcrumbs included.
 */

let enabled = false;

const FILTERED = '[Filtered]';

/** Header names whose value is a credential. */
const CREDENTIAL_HEADER =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$|token|secret|session|password/i;

/** Query parameters whose value is a credential or a one-time grant. */
const CREDENTIAL_QUERY =
  /^(code|state|token|access_token|id_token|refresh_token|key|api_key|secret|password|signature|sig)$/i;

/** A path segment after one of these is a credential: the automation
 * webhook trigger's token and a shared thread's token. */
const CREDENTIAL_PATH =
  /(\/automations\/webhook\/|\/threads\/shared\/)[^/?#]+/g;

/** Mask the credentials a URL can carry in its path and query. */
export function scrubUrl(url: string): string {
  const queryAt = url.indexOf('?');
  const head = queryAt === -1 ? url : url.slice(0, queryAt);
  const path = head.replace(CREDENTIAL_PATH, `$1${FILTERED}`);
  if (queryAt === -1) return path;
  const rest = url.slice(queryAt + 1);
  const fragmentAt = rest.indexOf('#');
  const search = fragmentAt === -1 ? rest : rest.slice(0, fragmentAt);
  const fragment = fragmentAt === -1 ? '' : rest.slice(fragmentAt);
  const params = search
    .split('&')
    .map((pair) => {
      const name = pair.split('=', 1)[0] ?? '';
      return CREDENTIAL_QUERY.test(name) ? `${name}=${FILTERED}` : pair;
    })
    .join('&');
  return `${path}?${params}${fragment}`;
}

/**
 * Drop cookies and bodies, and mask credential headers, path segments and
 * query values, on the event's request, its transaction name, the path this
 * module records and its breadcrumbs. Mutates and returns the event it was
 * given.
 */
export function scrubEvent<T extends Sentry.Event>(event: T): T {
  const request = event.request;
  if (request !== undefined) {
    delete request.cookies;
    delete request.data;
    if (request.headers !== undefined) {
      for (const name of Object.keys(request.headers)) {
        if (CREDENTIAL_HEADER.test(name)) request.headers[name] = FILTERED;
      }
    }
    if (typeof request.url === 'string') request.url = scrubUrl(request.url);
    if (typeof request.query_string === 'string') {
      request.query_string = scrubUrl(`?${request.query_string}`).slice(1);
    } else if (request.query_string !== undefined) {
      delete request.query_string;
    }
  }
  // The server integration names the transaction after the raw path.
  if (typeof event.transaction === 'string') {
    event.transaction = scrubUrl(event.transaction);
  }
  if (typeof event.extra?.path === 'string') {
    event.extra.path = scrubUrl(event.extra.path);
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    const data = breadcrumb.data;
    if (data !== undefined && typeof data.url === 'string') {
      data.url = scrubUrl(data.url);
    }
  }
  return event;
}

/** The default integrations `initErrorReporting` re-adds with its own
 * options (their names as the SDK reports them). */
const REPLACED_DEFAULT_INTEGRATIONS: ReadonlySet<string> = new Set([
  'OnUnhandledRejection',
  'Http',
  'NodeFetch',
]);

export interface ErrorReportingOptions {
  dsn: string | undefined;
  /** Process role (`api` | `worker` | `all`) — tagged on every event. */
  role: string;
}

export function initErrorReporting(options: ErrorReportingOptions): boolean {
  if (!options.dsn) return false;
  try {
    Sentry.init({
      dsn: options.dsn,
      release: process.env.TALE_VERSION,
      registerEsmLoaderHooks: false,
      // No outgoing request carries our trace headers (see the module note).
      tracePropagationTargets: [],
      // No credential leaves with an event (see the module note).
      sendDefaultPii: false,
      beforeSend: (event) => scrubEvent(event),
      integrations: (defaults) => [
        ...defaults.filter((i) => !REPLACED_DEFAULT_INTEGRATIONS.has(i.name)),
        // The request lanes without OpenTelemetry's span instrumentation:
        // its propagator does not honour the target list for an unsampled
        // span (see the module note). Request bodies are never captured.
        Sentry.httpIntegration({
          spans: false,
          maxIncomingRequestBodySize: 'none',
        }),
        Sentry.nativeNodeFetchIntegration({ spans: false }),
        Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
      ],
      initialScope: { tags: { 'tale.role': options.role } },
    });
    enabled = true;
  } catch (error) {
    // A malformed DSN must never take the backend down with it.
    console.warn(
      '[backend] error reporting init failed (continuing without):',
      error,
    );
  }
  return enabled;
}

/** Test seam: whether the SDK initialized (and reset between cases). */
export function errorReportingEnabled(): boolean {
  return enabled;
}

export interface ErrorReportContext {
  /** Low-cardinality only — tags become filterable index dimensions. */
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  /** The event's severity; `error` when omitted. */
  level?: Sentry.SeverityLevel;
}

export function reportError(
  error: unknown,
  context?: ErrorReportContext,
): void {
  if (!enabled) return;
  Sentry.captureException(error, context);
}

/** Drain the outbound queue — call before an intentional `process.exit`. */
export async function flushErrorReporting(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch (error) {
    console.warn('[backend] error reporting flush failed:', error);
  }
}

/** The request id the app-level `requestId` middleware stamped, when any —
 * the one handle a caller can quote back from an error response. */
export function requestIdOf(c: Context): string | undefined {
  const value: unknown = c.get('requestId');
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Report an error a handler let escape — Sentry (no-op without a DSN) plus
 * the console — tagged by method and the bounded route class, with the
 * request id so a report and the response the caller saw correlate. The
 * reporting half of `appErrorHandler`, shared with doors that answer their
 * own 500 shape (the REST door's JSON envelope).
 */
export function reportRequestError(err: Error, c: Context): void {
  const requestId = requestIdOf(c);
  reportError(err, {
    tags: {
      'http.method': c.req.method,
      // The bounded route vocabulary, never the raw path — same cardinality
      // rule as the Prometheus labels.
      'http.route_class': routeClass(c.req.path),
      ...(requestId === undefined ? {} : { 'http.request_id': requestId }),
    },
    extra: { path: scrubUrl(c.req.path) },
  });
  console.error(err);
}

/** The wait a request the database could not serve asks for, in seconds —
 * the edge's own `UPSTREAM_UNAVAILABLE` hint (services/proxy/Caddyfile): a
 * restart is usually over within seconds. */
const DATABASE_RETRY_AFTER_SECONDS = 5;

/**
 * The 503 a request answers when the database is unavailable
 * (`db/unavailable.ts`) — or `undefined` when `err` is something else.
 * Unreported: a restart fails every request in flight at once, and a report
 * per request buried everything else in the tracker. One warn line each
 * instead, and a `Retry-After` the caller can wait out.
 */
export function databaseUnavailableResponse(
  err: unknown,
  c: Context,
  origin?: DatabaseErrorOrigin,
): Response | undefined {
  const cause = databaseUnavailableCause(err, origin);
  if (cause === undefined) return undefined;
  const requestId = requestIdOf(c);
  console.warn(
    `[backend] database unavailable — 503 for ${c.req.method} ${scrubUrl(c.req.path)}: ${describeDatabaseError(cause)}`,
  );
  return c.json(
    {
      error:
        'The platform’s database is not answering right now — it may be restarting; retry with backoff',
      code: 'DATABASE_UNAVAILABLE',
      ...(requestId === undefined ? {} : { requestId }),
    },
    503,
    {
      'Retry-After': String(DATABASE_RETRY_AFTER_SECONDS),
      'Cache-Control': 'no-store',
    },
  );
}

/**
 * Hono's default error handler plus a capture: `getResponse` carriers
 * (HTTPException) pass through untouched — those are deliberate responses,
 * not defects — an unavailable database answers its 503, and everything else
 * is a real 500, reported. The backend signals expected 4xx via
 * `c.json(..., 4xx)` returns, so any other error reaching this handler is
 * report-worthy.
 */
export const appErrorHandler: ErrorHandler = (err, c) => {
  if ('getResponse' in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  const unavailable = databaseUnavailableResponse(err, c);
  if (unavailable !== undefined) return unavailable;
  reportRequestError(err, c);
  return c.text('Internal Server Error', 500);
};

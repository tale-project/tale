import * as Sentry from '@sentry/node';
import { callSiteOf, isSerializationFailure } from '@tale/shared/db/retry';
import { scrubEvent, scrubUrl } from '@tale/shared/monitoring/privacy';
import type { Context, ErrorHandler } from 'hono';

import type { KnowledgeOutage } from './core/knowledge/pool.ts';
import {
  databaseUnavailableCause,
  describeDatabaseError,
  knowledgeDatabaseUnavailable,
  swallowedDatabaseError,
  type DatabaseErrorOrigin,
  type KnowledgeDatabase,
} from './db/unavailable.ts';
import { methodClass, routeClass } from './telemetry.ts';
import { configureBackendTracing, scrubTransaction } from './tracing.ts';

/**
 * Sentry-compatible error reporting for the 0.5 backend (api + worker roles).
 *
 * Opt-in via `SENTRY_DSN`, exactly like the browser SPA: unset means every
 * function here is a no-op and the SDK never initializes. The DSN already
 * reaches the backend containers (both compose lanes mount `env_file: .env`);
 * this module is what makes the process honor it.
 *
 * Errors by default. BACKEND_SENTRY_TRACES_SAMPLE_RATE opts into manual
 * request and worker spans, independently of the browser's sampling knob.
 * Automatic performance integrations are excluded: they collect SQL, URLs
 * and payloads outside the bounded operational data our manual spans need.
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
 * loader onto that chain buys nothing for manual spans and risks resolver
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

export { scrubEvent, scrubUrl } from '@tale/shared/monitoring/privacy';

let enabled = false;

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
  tracesSampleRate?: number;
}

export function initErrorReporting(options: ErrorReportingOptions): boolean {
  if (!options.dsn) return false;
  try {
    Sentry.init({
      dsn: options.dsn,
      release: process.env.TALE_VERSION,
      registerEsmLoaderHooks: false,
      tracesSampleRate: options.tracesSampleRate ?? 0,
      defaultIntegrations: Sentry.getDefaultIntegrationsWithoutPerformance(),
      // No outgoing request carries our trace headers (see the module note).
      tracePropagationTargets: [],
      // No credential leaves with an event (see the module note).
      sendDefaultPii: false,
      beforeSend: (event) => scrubEvent(event),
      beforeSendTransaction: scrubTransaction,
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
    configureBackendTracing((options.tracesSampleRate ?? 0) > 0);
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
      'http.method': methodClass(c.req.method),
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
 * restart is usually over within seconds. An MCP call the database could not
 * serve asks for the same (`domains/mcp/refusals.ts`). */
export const DATABASE_RETRY_AFTER_SECONDS = 5;

/**
 * The 503 a request answers when the database is unavailable
 * (`db/unavailable.ts`) — or `undefined` when `err` is something else.
 * Unreported: a restart fails every request in flight at once, and a report
 * per request buried everything else in the tracker. One warn line each
 * instead, and a `Retry-After` the caller can wait out.
 *
 * A knowledge database that is unavailable — the deployment's default corpus
 * database or an organization's own — answers a code of its own,
 * `KNOWLEDGE_DATABASE_UNAVAILABLE`, with the same wait: it is not the
 * platform's database restarting, and saying so sent operators to the wrong
 * one. Unreported per request as well: its pool reports an outage that
 * outlasts a routine restart, once ({@link reportKnowledgeDatabaseOutage}).
 */
export function databaseUnavailableResponse(
  err: unknown,
  c: Context,
  origin?: DatabaseErrorOrigin,
): Response | undefined {
  const knowledge = knowledgeDatabaseUnavailable(err);
  if (knowledge !== null) {
    return knowledgeDatabaseUnavailableResponse(err, knowledge, c);
  }
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

function knowledgeDatabaseUnavailableResponse(
  err: unknown,
  database: KnowledgeDatabase,
  c: Context,
): Response {
  const requestId = requestIdOf(c);
  console.warn(
    `[backend] knowledge database unavailable (${database}) — 503 for ${c.req.method} ${scrubUrl(c.req.path)}: ${describeDatabaseError(err)}`,
  );
  return c.json(
    {
      error:
        'The knowledge database is not answering right now; retry with backoff',
      code: 'KNOWLEDGE_DATABASE_UNAVAILABLE',
      ...(requestId === undefined ? {} : { requestId }),
    },
    503,
    {
      'Retry-After': String(DATABASE_RETRY_AFTER_SECONDS),
      'Cache-Control': 'no-store',
    },
  );
}

/** What the tracker groups a knowledge database outage under: never the
 * driver's error, whose message names the host it could not reach. */
class KnowledgeDatabaseUnavailableError extends Error {
  override name = 'KnowledgeDatabaseUnavailableError';
}

/**
 * Report a knowledge database outage that outlasted a routine restart — once
 * per outage, when its pool says so (`core/knowledge/pool.ts`, which `main.ts`
 * hands this to: the pool cannot import this module). At warning level,
 * tagged with which database it was; for an organization's own, its slug says
 * whose to look at. Nothing of the connection goes with it — no URL, host,
 * user, statement or parameter: the driver's code at most.
 */
export function reportKnowledgeDatabaseOutage(outage: KnowledgeOutage): void {
  reportError(
    new KnowledgeDatabaseUnavailableError(
      outage.database === 'deployment'
        ? 'The deployment’s knowledge database is not answering'
        : 'An organization’s own knowledge database is not answering',
    ),
    {
      level: 'warning',
      tags: {
        'tale.reason': 'knowledge_database_unavailable',
        'tale.knowledge_database': outage.database,
      },
      extra: {
        outageMs: outage.outageMs,
        ...(outage.code === undefined ? {} : { code: outage.code }),
        ...(outage.orgSlug === undefined ? {} : { orgSlug: outage.orgSlug }),
      },
    },
  );
}

/** The wait a write that lost to concurrent writers asks for, in seconds: one
 * lost round is over in milliseconds, and eight reruns already waited. */
const WRITE_CONFLICT_RETRY_AFTER_SECONDS = 1;

/**
 * The 503 a request answers when its write kept losing to concurrent writers
 * and its serializable transaction (`transactSerializable`) ran out of
 * reruns — or `undefined` when `err` is something else. The caller is not at
 * fault and nothing was applied, so a retry is the right answer and says so:
 * `Retry-After`, in the door's flat envelope with the generic `HTTP_ERROR`
 * code (a client that does not know a code reads the status, a retryable
 * 503). It used to be a plain 500 with the error's stack on the console.
 *
 * Still reported, at warning level and tagged: rows this hot are the
 * engineering team's to find (`markRetryQueueKey` makes a rerun wait its
 * turn), and the log line names the write that kept losing.
 */
export function writeConflictResponse(
  err: unknown,
  c: Context,
): Response | undefined {
  if (!isSerializationFailure(err)) return undefined;
  const requestId = requestIdOf(c);
  const site = callSiteOf(err);
  console.warn(
    `[backend] write conflict — 503 for ${c.req.method} ${scrubUrl(c.req.path)}${site === undefined ? '' : ` (${site})`}: ${describeDatabaseError(err)}`,
  );
  reportError(err, {
    level: 'warning',
    tags: {
      'tale.reason': 'write_conflict',
      'http.method': methodClass(c.req.method),
      'http.route_class': routeClass(c.req.path),
      ...(requestId === undefined ? {} : { 'http.request_id': requestId }),
    },
    extra: {
      path: scrubUrl(c.req.path),
      ...(site === undefined ? {} : { site }),
    },
  });
  return c.json(
    {
      error:
        'Other changes were being written at the same moment and this one could not be applied; retry',
      code: 'HTTP_ERROR',
      ...(requestId === undefined ? {} : { requestId }),
    },
    503,
    {
      'Retry-After': String(WRITE_CONFLICT_RETRY_AFTER_SECONDS),
      'Cache-Control': 'no-store',
    },
  );
}

/**
 * `response` — an answer a library built for a request — or, when the database
 * failed while the request ran, the 503 {@link databaseUnavailableResponse}
 * instead.
 *
 * Better Auth reads the session in its middleware and, when the read throws,
 * logs the database error and carries on without a session: the endpoint
 * answers a 401 `UNAUTHORIZED` for a session that is perfectly good. The app
 * reads that answer as "this session ended" and takes the tab to sign-in, so a
 * database restart signed people out. Its `get-session` throws a 500 the
 * same way. The logger notes the database error for the request
 * (`auth/auth.ts`), so a 401 or a 5xx with one noted is the outage speaking.
 * Any other answer, and any request that met no database error, passes.
 */
export function outageInsteadOf(response: Response, c: Context): Response {
  if (response.status !== 401 && response.status < 500) return response;
  const noted = swallowedDatabaseError();
  if (noted === undefined) return response;
  return (
    databaseUnavailableResponse(noted, c, { fromDatabase: true }) ?? response
  );
}

/** Node's own error for a request body the client stopped sending:
 * `Error: aborted` with `ECONNRESET` — searched a few `cause`s deep, in
 * case a layer wrapped the read that failed. */
function isRequestAbortError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (
      current.message === 'aborted' &&
      Reflect.get(current, 'code') === 'ECONNRESET'
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/**
 * Whether `err` is a client that went away before its request was answered
 * — a closed tab, a cancelled upload, a proxy that gave up. Node fails the
 * body read with `Error: aborted` (`ECONNRESET`), and the adapter aborts
 * the request's signal as the socket closes, before that error reaches a
 * handler. Both are required: the same `Error: aborted` is what Node's HTTP
 * client raises for an OUTBOUND response cut mid-body (an object-store
 * read), a failure of ours with the caller still waiting; and a defect
 * thrown after the caller left is still a defect.
 */
function isClientAbort(err: unknown, c: Context): boolean {
  return isRequestAbortError(err) && c.req.raw.signal.aborted;
}

/** nginx's "client closed request": nobody is left to read the answer, so
 * the status is for the request metrics — a 4xx, never an outage. */
const CLIENT_CLOSED_REQUEST = 499;

/**
 * The answer a request the client abandoned gets — or `undefined` when
 * `err` is something else. Unreported: a client leaving is not a defect,
 * and every closed tab mid-upload used to land in the tracker as a 500.
 * One debug line instead.
 */
export function clientAbortResponse(
  err: unknown,
  c: Context,
): Response | undefined {
  if (!isClientAbort(err, c)) return undefined;
  console.debug(
    `[backend] client closed the request — ${CLIENT_CLOSED_REQUEST} for ${c.req.method} ${scrubUrl(c.req.path)}`,
  );
  return new Response(null, { status: CLIENT_CLOSED_REQUEST });
}

/**
 * Hono's default error handler plus a capture: `getResponse` carriers
 * (HTTPException) pass through untouched — those are deliberate responses,
 * not defects — an unavailable database (the platform's or a knowledge
 * database) answers its 503, a client that left answers its unread 499,
 * and everything else is a real 500, reported.
 * The backend signals expected 4xx via `c.json(..., 4xx)` returns (and an
 * app-door body that is not JSON as the 400 `lib/app-json-body.ts`
 * throws), so any other error reaching this handler is report-worthy.
 */
export const appErrorHandler: ErrorHandler = (err, c) => {
  if ('getResponse' in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  const unavailable = databaseUnavailableResponse(err, c);
  if (unavailable !== undefined) return unavailable;
  const conflict = writeConflictResponse(err, c);
  if (conflict !== undefined) return conflict;
  const abandoned = clientAbortResponse(err, c);
  if (abandoned !== undefined) return abandoned;
  reportRequestError(err, c);
  return c.text('Internal Server Error', 500);
};

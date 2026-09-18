import * as Sentry from '@sentry/node';
import type { Context, ErrorHandler } from 'hono';

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
 */

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
      integrations: (defaults) => [
        ...defaults.filter((i) => !REPLACED_DEFAULT_INTEGRATIONS.has(i.name)),
        // The request lanes without OpenTelemetry's span instrumentation:
        // its propagator does not honour the target list for an unsampled
        // span (see the module note).
        Sentry.httpIntegration({ spans: false }),
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

/**
 * Hono's default error handler, byte-for-byte, plus a capture: `getResponse`
 * carriers (HTTPException) pass through untouched — those are deliberate
 * responses, not defects — and everything else is a real 500. The backend
 * signals expected 4xx via `c.json(..., 4xx)` returns, so an error object
 * reaching this handler is always report-worthy.
 */
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
    extra: { path: c.req.path },
  });
  console.error(err);
}

export const appErrorHandler: ErrorHandler = (err, c) => {
  if ('getResponse' in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  reportRequestError(err, c);
  return c.text('Internal Server Error', 500);
};

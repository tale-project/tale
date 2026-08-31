import * as Sentry from '@sentry/node';
import type { ErrorHandler } from 'hono';

import { routeClass } from './telemetry.ts';

/**
 * Sentry-compatible error reporting for the 0.5 backend (api + worker roles).
 *
 * Opt-in via `SENTRY_DSN`, exactly like the browser SPA: unset means every
 * function here is a no-op and the SDK never initializes. The DSN already
 * reaches the backend containers (both compose lanes mount `env_file: .env`);
 * this module is what makes the process honor it.
 *
 * Errors only, deliberately: no `tracesSampleRate` is ever set, so span
 * recording stays disabled and none of the auto-performance instrumentation
 * loads. `SENTRY_TRACES_SAMPLE_RATE` remains a browser-side knob.
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
      integrations: (defaults) => [
        ...defaults.filter((i) => i.name !== 'OnUnhandledRejection'),
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
export const appErrorHandler: ErrorHandler = (err, c) => {
  if ('getResponse' in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  reportError(err, {
    tags: {
      'http.method': c.req.method,
      // The bounded route vocabulary, never the raw path — same cardinality
      // rule as the Prometheus labels.
      'http.route_class': routeClass(c.req.path),
    },
    extra: { path: c.req.path },
  });
  console.error(err);
  return c.text('Internal Server Error', 500);
};

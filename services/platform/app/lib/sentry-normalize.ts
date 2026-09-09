/**
 * Normalize Convex failure text before events leave for Sentry/GlitchTip.
 *
 * Convex composes every client-visible failure as
 * `[CONVEX A(agents/actions:listAgents)] [Request ID: 018f2a…] Server Error
 *  Uncaught AppError: …` — and the convex client also `console.error`s the
 * same line, which `captureConsoleIntegration` promotes to a message event.
 * Sentry groups message events by their text, so the per-call request id
 * defeats grouping and every occurrence opens a NEW issue (observed as ~40
 * single-event issue groups on the demo project). Stripping the volatile
 * token restores one-issue-per-root-cause grouping; the function path and the
 * underlying error text stay, so issues remain actionable.
 */

/** `[Request ID: …]` plus the whitespace that follows it. */
const REQUEST_ID_RE = /\[Request ID: [^\]]*\]\s*/g;

export function stripConvexRequestId(text: string): string {
  return text.replace(REQUEST_ID_RE, '');
}

/**
 * The subset of a Sentry `ErrorEvent` this normalization touches — message
 * events (including console-promoted ones via `logentry`) and exception
 * values. Structural so the helper stays SDK-version-agnostic and testable.
 */
interface NormalizableSentryEvent {
  message?: string;
  logentry?: { message?: string; params?: unknown[] };
  exception?: { values?: { value?: string }[] };
  request?: {
    url?: string;
    query_string?: unknown;
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
  };
  breadcrumbs?: { data?: Record<string, unknown> }[];
}

/** OAuth codes/state and signed callback queries must never leave the browser. */
function withoutUrlSecrets(value: string): string {
  return value.split(/[?#]/)[0] ?? '';
}

/**
 * Strip volatile Convex request ids everywhere Sentry derives grouping from.
 * Mutates and returns the event — the `beforeSend` contract allows in-place
 * edits, and events are never reused after sending.
 */
export function normalizeConvexSentryEvent<
  Event extends NormalizableSentryEvent,
>(event: Event): Event {
  if (event.request) {
    if (event.request.url)
      event.request.url = withoutUrlSecrets(event.request.url);
    delete event.request.query_string;
    delete event.request.data;
    delete event.request.cookies;
    for (const [key, value] of Object.entries(event.request.headers ?? {})) {
      const name = key.toLowerCase();
      if (
        ['authorization', 'cookie', 'set-cookie', 'x-api-key'].includes(name)
      ) {
        delete event.request.headers?.[key];
      } else if (name === 'referer' || name === 'referrer') {
        if (event.request.headers)
          event.request.headers[key] = withoutUrlSecrets(value);
      }
    }
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (!breadcrumb.data) continue;
    for (const key of ['url', 'from', 'to', 'referer', 'referrer']) {
      const value = breadcrumb.data[key];
      if (typeof value === 'string')
        breadcrumb.data[key] = withoutUrlSecrets(value);
    }
  }
  if (typeof event.message === 'string') {
    event.message = stripConvexRequestId(event.message);
  }
  if (typeof event.logentry?.message === 'string') {
    event.logentry.message = stripConvexRequestId(event.logentry.message);
  }
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === 'string') {
      exception.value = stripConvexRequestId(exception.value);
    }
  }
  return event;
}

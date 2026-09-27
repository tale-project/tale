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
 *
 * It also recognizes the events that report no failure at all — a cancelled
 * request (`isAbortErrorEvent`) — so `beforeSend` can drop them.
 */

import { isAbortError } from '@/lib/utils/abort-error';

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
  exception?: { values?: { type?: string; value?: string }[] };
  extra?: Record<string, unknown>;
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

/** `AbortError`, alone or as the head of `AbortError: <message>`. */
const ABORT_ERROR_TEXT_RE = /^AbortError(?::|$)/;

/**
 * A cancelled request is no failure, so it must never open an issue: the
 * backstop behind the fetch seam, which already treats an abort as the
 * caller's own doing. TanStack Query aborts every read still in flight when
 * a navigation unmounts its page; whichever handler then hands the rejection
 * to the SDK, the event is dropped here. Recognized by the thrown value
 * itself, by a value a console-promoted event logged (an error boundary's
 * logger passes the error's fields, not the error), else by the two shapes
 * the SDK builds from Chromium's `DOMException`: `AbortError: signal is
 * aborted without reason`, and — the stackless one an abort mid-body raises,
 * which the SDK can only stringify — `Error: AbortError: The user aborted a
 * request.`.
 */
export function isAbortErrorEvent(
  event: NormalizableSentryEvent,
  hint?: { originalException?: unknown },
): boolean {
  if (isAbortError(hint?.originalException)) return true;
  const logged = event.extra?.arguments;
  if (Array.isArray(logged) && logged.some(isAbortError)) return true;
  const values = event.exception?.values ?? [];
  // The last value is the thrown error; any before it are its causes.
  const thrown = values.at(-1);
  if (thrown === undefined) return false;
  return (
    thrown.type === 'AbortError' ||
    (typeof thrown.value === 'string' && ABORT_ERROR_TEXT_RE.test(thrown.value))
  );
}

/**
 * Normalize Convex failure text before events leave for Sentry/GlitchTip.
 *
 * Convex composes every client-visible failure as
 * `[CONVEX A(agents/actions:listAgents)] [Request ID: 018f2a…] Server Error
 *  Uncaught BackendError: …` — and the convex client also `console.error`s the
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
}

/**
 * Strip volatile Convex request ids everywhere Sentry derives grouping from.
 * Mutates and returns the event — the `beforeSend` contract allows in-place
 * edits, and events are never reused after sending.
 */
export function normalizeConvexSentryEvent<
  Event extends NormalizableSentryEvent,
>(event: Event): Event {
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

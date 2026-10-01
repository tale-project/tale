/**
 * Prepare browser events before they leave for Sentry/GlitchTip: drop what is
 * not ours to fix, and normalize what is.
 *
 * `prepareSentryEvent`, the app's `beforeSend`, drops five kinds of event:
 * - a cancelled request (`isAbortErrorEvent`), which reports no failure at
 *   all;
 * - an error a browser extension threw, told by its innermost frame. One
 *   visitor's `fetch`-wrapping extension kept opening new issue groups,
 *   because its minified frames re-fingerprint every few days (#3094);
 * - an expected refusal: a 4xx the surface already explains, which the
 *   mutation and action hooks still log through `console.error`;
 * - a transport failure: the TypeError the browser raises for a request that
 *   got no answer at all, which the offline overlay already reports;
 * - a request the platform was briefly gone for (`isPlatformUnavailable`):
 *   the edge's `UPSTREAM_UNAVAILABLE` while it restarts or a deployment
 *   rolls, the platform's `DATABASE_UNAVAILABLE` while its database
 *   restarts. Every open tab meets one at once, and the failed write's toast
 *   or the list's error state already tells the person; one restart used to
 *   open an error event per failed request.
 *
 * What stays is normalized. Convex composes every client-visible failure as
 * `[CONVEX A(agents/actions:listAgents)] [Request ID: 018f2a…] Server Error
 *  Uncaught AppError: …` — and the convex client also `console.error`s the
 * same line, which `captureConsoleIntegration` promotes to a message event.
 * Sentry groups message events by their text, so the per-call request id
 * defeats grouping and every occurrence opens a NEW issue (observed as ~40
 * single-event issue groups on the demo project). Stripping the volatile
 * token restores one-issue-per-root-cause grouping; the function path and the
 * underlying error text stay, so issues remain actionable.
 */

import { isBackendRefusal } from '@/app/lib/backend/adapters';
import { isPlatformUnavailable } from '@/app/lib/backend/platform-unavailable';
import { TRANSPORT_FAILURE_RE } from '@/app/lib/backend/transport-failure';
import { isAbortError } from '@/lib/utils/abort-error';

/** `[Request ID: …]` plus the whitespace that follows it. */
const REQUEST_ID_RE = /\[Request ID: [^\]]*\]\s*/g;

export function stripConvexRequestId(text: string): string {
  return text.replace(REQUEST_ID_RE, '');
}

/** One exception value of an event, its frames outermost first. */
interface SentryException {
  type?: string;
  value?: string;
  stacktrace?: { frames?: { filename?: string }[] };
}

/**
 * The subset of a Sentry `ErrorEvent` this module reads and touches — message
 * events (including console-promoted ones via `logentry`, with the values
 * they logged in `extra.arguments`) and exception values. Structural so the
 * helpers stay SDK-version-agnostic and testable.
 */
interface NormalizableSentryEvent {
  message?: string;
  logentry?: { message?: string; params?: unknown[] };
  exception?: { values?: SentryException[] };
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

/**
 * The error the event reports: the SDK lists an error's linked causes first
 * and the thrown error itself last.
 */
function thrownException(
  event: NormalizableSentryEvent,
): SentryException | undefined {
  return event.exception?.values?.at(-1);
}

/** `AbortError`, alone or as the head of `AbortError: <message>`. */
const ABORT_ERROR_TEXT_RE = /^AbortError(?::|$)/;

/**
 * A cancelled request is no failure, so it must never open an issue: the
 * backstop behind the fetch seam, which already treats an abort as the
 * caller's own doing. TanStack Query aborts every read still in flight when
 * a navigation unmounts its page; whichever handler then hands the rejection
 * to the SDK, the event is dropped here. Recognized by the thrown value
 * itself, by a value a console-promoted event logged (a logged value that is
 * no Error reaches the SDK only as an argument), else by the two shapes
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
  const thrown = thrownException(event);
  if (thrown === undefined) return false;
  return (
    thrown.type === 'AbortError' ||
    (typeof thrown.value === 'string' && ABORT_ERROR_TEXT_RE.test(thrown.value))
  );
}

/**
 * Where a browser extension's scripts live: the Chromium, Firefox and Safari
 * extension schemes, and the URL Safari writes into a stack in place of a
 * script an extension injected into the page. `Sentry.init` passes the same
 * list as `denyUrls`, so the SDK's own filter and `prepareSentryEvent` agree.
 */
export const BROWSER_EXTENSION_URLS: RegExp[] = [
  /^chrome-extension:\/\//,
  /^moz-extension:\/\//,
  /^safari(-web)?-extension:\/\//,
  /^webkit-masked-url:\/\//,
];

/**
 * Whether the innermost frame that names a script belongs to an extension —
 * `<anonymous>` and native frames say nothing about who threw. The SDK
 * applies `denyUrls` by the same rule. An extension that wraps a callback of
 * ours (a timer, a listener) sits further out, so when our callback throws,
 * the error keeps reporting.
 */
function isFromBrowserExtension(event: NormalizableSentryEvent): boolean {
  const frames = thrownException(event)?.stacktrace?.frames ?? [];
  const innermost = frames.findLast(
    (frame) =>
      frame.filename !== '<anonymous>' && frame.filename !== '[native code]',
  );
  const url = innermost?.filename;
  return (
    url !== undefined &&
    BROWSER_EXTENSION_URLS.some((pattern) => pattern.test(url))
  );
}

/** The event of a request that got no answer ({@link TRANSPORT_FAILURE_RE}). */
function isTransportFailure(event: NormalizableSentryEvent): boolean {
  const thrown = thrownException(event);
  return (
    thrown?.type === 'TypeError' &&
    TRANSPORT_FAILURE_RE.test(thrown.value ?? '')
  );
}

/**
 * The app's `beforeSend`: drop a cancelled request, an extension's error, an
 * expected refusal, a transport failure and a request the platform was
 * briefly gone for (`null` tells the SDK not to send), and normalize every
 * event that stays. A refusal and an unavailable platform are judged on the
 * thrown value itself, which the SDK hands over as `hint.originalException`:
 * a `BackendApiError` keeps its status and code there, so every other 5xx
 * still reports.
 */
export function prepareSentryEvent<Event extends NormalizableSentryEvent>(
  event: Event,
  hint?: { originalException?: unknown },
): Event | null {
  if (
    isAbortErrorEvent(event, hint) ||
    isFromBrowserExtension(event) ||
    isBackendRefusal(hint?.originalException) ||
    isTransportFailure(event) ||
    isPlatformUnavailable(hint?.originalException)
  ) {
    return null;
  }
  return normalizeConvexSentryEvent(event);
}

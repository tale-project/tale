/**
 * Grouping normalization for Convex client errors reaching Sentry (#3020).
 *
 * convex/react logs every failed call via
 * `console.error('[CONVEX A(module:fn)] [Request ID: abc123] Server Error …')`,
 * and `captureConsoleIntegration` promotes each such line to an event. The
 * embedded Request ID is unique per call, so message-based grouping never
 * matches — a recurring failure mints a brand-new GlitchTip issue per EVENT
 * (100+ single-event issues during the #3019 incident, enough to bury a real
 * regression) instead of one issue with N events.
 *
 * `beforeSend` therefore strips the Request ID out of the message and
 * fingerprints on the stripped text. Nothing is lost: the id survives as a
 * searchable `convex.request_id` tag, and the integration already preserves
 * the raw console arguments in `extra.arguments`.
 *
 * Console-captured lines whose payload carries a code the client handles
 * terminally (org gone / not a member / session rotation) are dropped
 * outright: the recovery path is the feature, and the server-side report of
 * the same failure already exists. An error that actually reached a boundary
 * (an exception event) is real user impact and is kept — just grouped.
 */

import type { ErrorEvent } from '@sentry/tanstackstart-react';

/** The `[CONVEX Q(module:fn)]` / `M` / `A` prefix convex/react logs. */
const CONVEX_CONSOLE_LINE = /^\[CONVEX [A-Z]+\([^)]*\)\]/;
const REQUEST_ID = /\s*\[Request ID: ([^\]]*)\]/;

/**
 * Codes the app already handles end-to-end: `ORG_NOT_FOUND` / `ORG_FORBIDDEN`
 * bounce the tab to the org list (`dashboard/$id.tsx`), `UNAUTHENTICATED` is
 * the session-rotation window the layout boundary deliberately retries
 * (`layout-error-boundary.tsx`, #2013). Only applied to console-captured
 * lines — never to exceptions that reached a boundary.
 */
const CLIENT_HANDLED_CODES = /ORG_NOT_FOUND|ORG_FORBIDDEN|UNAUTHENTICATED/;

interface NormalizedConvexMessage {
  message: string;
  requestId: string | undefined;
}

/**
 * Strip the per-call Request ID out of a Convex client error line. Returns
 * `null` when the text is not one, so callers leave foreign events alone.
 */
export function normalizeConvexConsoleMessage(
  message: string,
): NormalizedConvexMessage | null {
  if (!CONVEX_CONSOLE_LINE.test(message)) return null;
  const requestId = REQUEST_ID.exec(message)?.[1];
  return { message: message.replace(REQUEST_ID, ''), requestId };
}

function applyGrouping(
  event: ErrorEvent,
  normalized: NormalizedConvexMessage,
): void {
  // GlitchTip groups on the fingerprint when present; capped so an embedded
  // payload dump cannot make every fingerprint unique all over again.
  event.fingerprint = [normalized.message.slice(0, 200)];
  if (normalized.requestId) {
    event.tags = { ...event.tags, 'convex.request_id': normalized.requestId };
  }
}

/**
 * `Sentry.init#beforeSend`: group Convex client failures by what failed, not
 * by which request happened to fail first.
 */
export function convexConsoleBeforeSend(event: ErrorEvent): ErrorEvent | null {
  // Console-captured failures: `captureConsoleIntegration` produces message
  // events and stamps them `logger: 'console'`.
  if (typeof event.message === 'string') {
    const normalized = normalizeConvexConsoleMessage(event.message);
    if (normalized) {
      if (
        event.logger === 'console' &&
        CLIENT_HANDLED_CODES.test(normalized.message)
      ) {
        return null;
      }
      event.message = normalized.message;
      applyGrouping(event, normalized);
      return event;
    }
  }

  // Errors thrown into a boundary carry the same text on the exception value.
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value !== 'string') continue;
    const normalized = normalizeConvexConsoleMessage(exception.value);
    if (!normalized) continue;
    exception.value = normalized.message;
    applyGrouping(event, normalized);
    break;
  }
  return event;
}

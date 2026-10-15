/**
 * What a failed mail-provider call means for a sync pass.
 *
 * A live connector body reports a failure as text — it throws, and the
 * connector door wraps the body's own sentence (`LIVE_BODY_FAILED`) — so the
 * sync reads the provider's words: the HTTP status the Gmail and Outlook
 * bodies put in brackets, Gmail's rate-limit reasons, Graph's throttling
 * sentence and the wait it names, the IMAP native's missing UID.
 *
 * - `rate_limited`: the provider asks the sync to slow down. The pass stops
 *   and keeps what it read; it is not a failure of the mailbox.
 * - `gone`: the message was deleted or moved after it was listed. Only a
 *   read of one message can say so; that message is skipped.
 * - `failed`: anything else — a revoked login, an unreachable server, a
 *   dropped connection. The pass stops and keeps what it read.
 */

export type MailCallFailure =
  | { kind: 'rate_limited'; retryAfterMs: number | null; message: string }
  | { kind: 'gone'; message: string }
  | { kind: 'failed'; message: string };

/** How a provider says "slow down": Gmail's 429 and its 403 reasons, Graph's
 * throttling sentence and codes. */
const RATE_LIMITED: readonly RegExp[] = [
  /\(429\b/,
  /\brate[- ]limit/i,
  /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/,
  /\btoo many (?:requests|concurrent)/i,
  /ApplicationThrottled|MailboxConcurrency/,
];

/** How a provider says a listed message is no longer there. */
const GONE: readonly RegExp[] = [
  /\(404\b/,
  /\bmessage \S+ not found\b/i,
  /\bno message with UID\b/i,
];

/** The wait a provider names, in seconds: `(429, retry after 30s)`,
 * `(retry after 120s)`, `Retry-After: 30`. */
const RETRY_AFTER = /retry[- ]after\W{0,3}(\d{1,6})\s*s?\b/i;

/** The longest wait the sync reports: a provider naming more is still asked
 * again on the next pass, so a day bounds a garbled header. */
const MAX_RETRY_AFTER_MS = 86_400_000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What `error`, thrown by a `list_messages` (`list`) or `get_message`
 * (`read`) call, means for the pass. */
export function classifyMailFailure(
  error: unknown,
  call: 'list' | 'read',
): MailCallFailure {
  const message = messageOf(error);
  if (RATE_LIMITED.some((pattern) => pattern.test(message))) {
    const seconds = RETRY_AFTER.exec(message)?.[1];
    return {
      kind: 'rate_limited',
      retryAfterMs:
        seconds === undefined
          ? null
          : Math.min(Number(seconds) * 1000, MAX_RETRY_AFTER_MS),
      message,
    };
  }
  if (call === 'read' && GONE.some((pattern) => pattern.test(message))) {
    return { kind: 'gone', message };
  }
  return { kind: 'failed', message };
}

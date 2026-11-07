import { readableErrorMessage } from '@tale/ui/error-message';
import type { TFunction } from 'i18next';

import type { Session } from '@/lib/api/schemas';
import { i18n } from '@/lib/i18n/i18n';
import { isRecord } from '@/lib/is-record';

import { ApiError } from './client';

/** The longest cause a sentence carries, in characters: the proxy check words it in a line or two. */
const CAUSE_MAX_LENGTH = 300;

/**
 * The cause the backend names (`reason`: the English words of the proxy check
 * or of the location lookup) as it can stand in the middle of a sentence: one
 * line, without control or invisible characters, without a full stop of its
 * own (the sentence ends with one), cut where it runs on. Whatever is not a
 * text, or says nothing, is no cause.
 */
export function causeOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const line = value
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim()
    .replace(/[.\s]+$/u, '');
  if (line === '') return null;
  const characters = Array.from(line);
  if (characters.length <= CAUSE_MAX_LENGTH) return line;
  return `${characters
    .slice(0, CAUSE_MAX_LENGTH - 1)
    .join('')
    .trimEnd()}…`;
}

/** A count the backend names: a whole number above none. */
function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

/** Does the app have words for this code (`errors.<code>`)? */
function hasWords(code: string): boolean {
  return i18n.exists(code, { ns: 'errors' });
}

/**
 * The sentence of a code the app words, from the code and from what the backend
 * names besides it (`extra`): the cause of a proxy that does not answer, how
 * many proxies failed their check, what a busy session is doing. Each of them
 * has a plain sentence for when the backend names nothing (older data, MCP, a
 * value that is no text or no count). `extra` is read for these fields only,
 * and only as a text or a count: nothing else of it is ever printed.
 *
 * One literal `t('…')` per sentence on purpose, so that the i18n gates see them.
 */
function wordedCode(code: string, extra: unknown, t: TFunction): string {
  const fields = isRecord(extra) ? extra : {};
  switch (code) {
    case 'proxy_unreachable': {
      const reason = causeOf(fields.reason);
      return reason === null
        ? t('proxy_unreachable')
        : t('proxy_unreachable_reason', { reason });
    }
    case 'unknown_ip_location': {
      const reason = causeOf(fields.reason);
      return reason === null
        ? t('unknown_ip_location')
        : t('unknown_ip_location_reason', { reason });
    }
    case 'browser_error': {
      const reason = causeOf(fields.reason);
      return reason === null
        ? t('browser_error')
        : t('browser_error_reason', { reason });
    }
    case 'no_working_proxy': {
      const failed = countOf(fields.failed);
      return failed === null
        ? t('no_working_proxy')
        : t('no_working_proxy_failed', { failed });
    }
    case 'session_busy':
      switch (fields.doing) {
        case 'assigning_proxy':
          return t('session_busy_assigning_proxy');
        case 'starting':
          return t('session_busy_starting');
        case 'stopping':
          return t('session_busy_stopping');
        default:
          return t('session_busy');
      }
    default:
      return t(code);
  }
}

/**
 * What a failed call says to the person: its stable code worded in their
 * language (`errors.<code>`), with the cause the answer names where there is
 * one (why a proxy does not work, how many failed their check, what a busy
 * session is doing), else a generic line. `t` is the `errors` namespace's.
 * Only the code and those few fields are worded: nothing else of the error
 * object (its message, its other extra fields, its status) is ever printed, and
 * a code the app has no words for never shows the backend's own English
 * sentence, which a person who reads German or French would meet as a
 * technical text. An error that is no `ApiError` (a fault in the page, or a
 * plain error whose message is a sentence for the person) is read by
 * `readableErrorMessage`, which prints nothing of a fault.
 */
export function failureText(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    return hasWords(error.code)
      ? wordedCode(error.code, error.extra, t)
      : t('fallback');
  }
  return readableErrorMessage(error) ?? t('fallback');
}

/** The answers that say only that the call failed and to try again, and nothing a person could mend. */
const ONLY_A_RETRY: ReadonlySet<string> = new Set([
  'internal_error',
  'server_error',
  'network',
]);

/**
 * What a read that failed names as its cause where a "Try again" button stands
 * beside the words: only a cause that trying again does not mend (a wrong
 * address, a secret that is gone), else `null`. The answers that only say "try
 * again" are left out, as the button says it and the page's banner says why the
 * server could not be asked: the two sentences ("Something went wrong. Try
 * again.") would put the button's words twice.
 */
export function readFailureCause(error: unknown, t: TFunction): string | null {
  const text = failureText(error, t);
  const onlyARetry =
    text === t('fallback') ||
    (error instanceof ApiError && ONLY_A_RETRY.has(error.code));
  return onlyARetry ? null : text;
}

/**
 * What a read that failed says where a "Try again" button stands beside the
 * words: what could not be loaded (`lead`, already worded) and, only when the
 * answer names a cause that trying again does not mend (`readFailureCause`),
 * that cause.
 *
 * The two sentences are joined with one space, each ending in its own full stop.
 */
export function readFailureText(
  lead: string,
  error: unknown,
  t: TFunction,
): string {
  const cause = readFailureCause(error, t);
  return cause === null ? lead : `${lead} ${cause}`;
}

/**
 * What a session failed with in the background, worded like the refusal of the
 * same code (`failureText`): from its `errorCode` and `errorExtra`. `null` when
 * the session has no code or the app has no words for it; the backend's own
 * sentence (`error`) is the caller's to show then.
 */
export function sessionFailureText(
  session: Pick<Session, 'errorCode' | 'errorExtra'>,
  t: TFunction,
): string | null {
  const { errorCode } = session;
  if (errorCode === null || !hasWords(errorCode)) return null;
  return wordedCode(errorCode, session.errorExtra, t);
}

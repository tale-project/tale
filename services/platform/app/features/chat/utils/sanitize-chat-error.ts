import {
  CHAT_ERROR_I18N_KEY,
  CHAT_ERROR_I18N_KEY_NAMED,
  type ChatErrorCode,
  classifyChatErrorCode,
  decodeChatError,
} from '@/lib/shared/chat-errors';

export interface SanitizedChatError {
  /** Canonical error code (authoritative when the backend stamped it). */
  code: ChatErrorCode;
  /** Resolved chat i18n key — the named variant when a provider/model is known. */
  i18nKey: string;
  /** Interpolation params for {@link i18nKey} (only the named variants use them). */
  params?: { provider?: string; model?: string };
  /** How many models were attempted before giving up (when known, > 1). */
  triedCount?: number;
  /**
   * One path-free line for surfaces that must stay small (the failure toast).
   * Absent when the first line is empty, oversized, or carries a stack-frame
   * or path token — a toast never shows raw provider JSON.
   */
  rawSummary?: string;
  /**
   * The verbatim provider/SDK error for the "Technical details" disclosure —
   * newlines preserved (provider bodies are pretty-printed JSON), stack-frame
   * lines stripped, truncated past {@link RAW_MESSAGE_MAX} but never dropped.
   * Secrets were already redacted server-side (`sanitizeError`) before the
   * text was stored.
   */
  rawMessage?: string;
}

/** Hard ceiling for the disclosure text — generous enough for a provider's
 * whole JSON error body, small enough that a runaway string cannot bloat the
 * message list. */
const RAW_MESSAGE_MAX = 4000;

const RAW_SUMMARY_MAX = 300;

/** A JS stack frame: `at fn (file:1:2)` / `at file:///app/x.js:10:5`. The
 * location suffix is required so prose that merely starts with "at …" (an
 * OpenAI "at most N images" complaint) is not mistaken for a frame. */
const STACK_FRAME_LINE = /^\s*at\s+.*(?:\(.*\)|:\d+:\d+)\s*$/;

/** Bundler/source locations that identify our internals, not the provider. */
const INTERNAL_PATH_TOKEN = /node_modules|\.[cm]?[jt]sx?:\d+/;

function stripNoisePrefix(text: string): string {
  return text
    .replace(/^\s*uncaught\s+/i, '')
    .replace(/^\s*error:\s*/i, '')
    .trim();
}

/**
 * Reduce a raw provider/SDK error to a single path-free line for a toast:
 * first line only, dropped entirely when a stack-frame or path token
 * survives. Deliberately conservative — the toast shows unprompted, so a
 * false drop is cheaper than a leaked path.
 */
function summaryLine(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const firstLine = stripNoisePrefix(raw.split('\n')[0]);
  if (
    firstLine.length === 0 ||
    firstLine.length > RAW_SUMMARY_MAX ||
    /\bat\s|node_modules|\.[cm]?[jt]sx?:\d+|https?:\/\/|(^|\s)\/\S/.test(
      firstLine,
    )
  ) {
    return undefined;
  }
  return firstLine;
}

/**
 * The full raw error for the "Technical details" disclosure. Multiline
 * provider bodies survive whole — that text is the only diagnostic record a
 * failed turn has, and first-lining a pretty-printed JSON body used to reduce
 * it to `{`. Only stack-frame and internal-path lines are removed; URLs and
 * route paths inside provider messages are legitimate content and stay.
 */
function detailMessage(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const kept = stripNoisePrefix(raw)
    .split('\n')
    .filter(
      (line) => !STACK_FRAME_LINE.test(line) && !INTERNAL_PATH_TOKEN.test(line),
    )
    .join('\n')
    .trim();
  if (kept.length === 0) return undefined;
  return kept.length > RAW_MESSAGE_MAX
    ? `${kept.slice(0, RAW_MESSAGE_MAX)}…`
    : kept;
}

/**
 * Resolve a failed chat turn's stored error into the localized, provider-aware
 * pieces the UI renders.
 *
 * Prefers the structured code the backend stamped onto the error
 * ({@link decodeChatError}); falls back to classifying the raw string when the
 * error predates the envelope or came from a non-chat path. The classification
 * logic itself is shared with the backend (see `lib/shared/chat-errors`).
 */
export function sanitizeChatError(
  rawError: string | undefined,
): SanitizedChatError {
  const decoded = decodeChatError(rawError);
  const code = decoded.code ?? classifyChatErrorCode(decoded.raw ?? '');
  const { provider, model, triedCount } = decoded;

  // Use the richer "named" message only when there's a name to fill in.
  const namedKey = CHAT_ERROR_I18N_KEY_NAMED[code];
  const useNamed = !!namedKey && (!!provider || !!model);

  return {
    code,
    i18nKey: useNamed && namedKey ? namedKey : CHAT_ERROR_I18N_KEY[code],
    params: useNamed ? { provider, model } : undefined,
    triedCount: triedCount != null && triedCount > 1 ? triedCount : undefined,
    rawSummary: summaryLine(decoded.raw),
    rawMessage: detailMessage(decoded.raw),
  };
}

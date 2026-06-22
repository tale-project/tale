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
   * The verbatim provider/SDK error for the "Technical details" disclosure.
   * Stack frames and file paths are stripped so they never reach the UI.
   */
  rawMessage?: string;
}

/**
 * Reduce a raw provider/SDK error to a single path-free line safe to show in
 * the "Technical details" disclosure. Stack frames and file paths (e.g.
 * `node_modules/ai/src/ui/process-ui-message-stream.ts:776:14`) must NEVER reach
 * the UI — take only the first line, strip the `Uncaught`/`Error:` noise, and
 * drop the message entirely if a stack-frame or path token survives.
 */
function cleanRawMessage(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const firstLine = raw
    .split('\n')[0]
    .replace(/^\s*uncaught\s+/i, '')
    .replace(/^\s*error:\s*/i, '')
    .trim();
  if (
    firstLine.length === 0 ||
    firstLine.length > 300 ||
    /\bat\s|node_modules|\.[cm]?[jt]sx?:\d+|https?:\/\/|(^|\s)\/\S/.test(
      firstLine,
    )
  ) {
    return undefined;
  }
  return firstLine;
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
    rawMessage: cleanRawMessage(decoded.raw),
  };
}

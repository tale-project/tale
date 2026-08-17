import type { SanitizedChatError } from '@/app/features/chat/utils/sanitize-chat-error';
import { sanitizeChatError } from '@/app/features/chat/utils/sanitize-chat-error';
import {
  CHAT_ERROR_I18N_KEY_NAMED,
  type ChatErrorCode,
  classifyChatErrorCode,
} from '@/lib/shared/chat-errors';

/** Provider/account failures — block generation until config changes. */
const HARD_FAILURE_CODES = new Set<ChatErrorCode>([
  'missing_api_key',
  'auth_error',
  'credit_exhausted',
  'provider_unreachable',
  'model_not_found',
]);

const MODEL_CALL_PREFIX = 'the model call failed: ';

function normalizeBuilderReason(raw: string): string {
  return raw.startsWith(MODEL_CALL_PREFIX)
    ? raw.slice(MODEL_CALL_PREFIX.length)
    : raw;
}

/** Builder model-call errors name the provider first: `anthropic answered 401: …`. */
function extractProviderFromReason(reason: string): string | undefined {
  const answered = /^(\S+) answered \d+:/.exec(reason);
  if (answered !== null) return answered[1];
  const unreachable = /^(\S+) was unreachable/.exec(reason);
  if (unreachable !== null) return unreachable[1];
  return undefined;
}

function withNamedProvider(
  sanitized: SanitizedChatError,
  provider: string | undefined,
): SanitizedChatError {
  if (provider === undefined || sanitized.params?.provider !== undefined) {
    return sanitized;
  }
  const namedKey = CHAT_ERROR_I18N_KEY_NAMED[sanitized.code];
  if (namedKey === undefined || sanitized.code === 'generic') {
    return sanitized;
  }
  return {
    ...sanitized,
    i18nKey: namedKey,
    params: { provider },
  };
}

export function sanitizeBuilderReason(
  raw: string,
  selectedProvider?: string,
): SanitizedChatError {
  const normalized = normalizeBuilderReason(raw);
  const provider =
    selectedProvider ?? extractProviderFromReason(normalized) ?? undefined;
  return withNamedProvider(sanitizeChatError(normalized), provider);
}

export function isBuilderHardFailure(code: ChatErrorCode): boolean {
  return HARD_FAILURE_CODES.has(code);
}

export function builderOutcomeVariant(
  code: ChatErrorCode,
  kind: 'failed' | 'gave-up',
): 'destructive' | 'warning' {
  if (kind === 'failed' || isBuilderHardFailure(code)) {
    return 'destructive';
  }
  return 'warning';
}

export function builderOutcomeUsesFailedTitle(
  code: ChatErrorCode,
  kind: 'failed' | 'gave-up',
): boolean {
  return kind === 'failed' || isBuilderHardFailure(code);
}

/** Body copy: localized hints for classified errors; the server reason for
 * soft give-ups. The body stays a one-line summary — the full provider text
 * belongs to the Technical details disclosure. */
export function builderOutcomeBodyText(
  sanitized: SanitizedChatError,
  rawReason: string,
  tChat: (
    key: string,
    params?: Record<string, string | number | undefined>,
  ) => string,
): string {
  if (sanitized.code === 'generic') {
    return sanitized.rawSummary ?? normalizeBuilderReason(rawReason);
  }
  return tChat(sanitized.i18nKey, sanitized.params);
}

export function builderShowsProviderSettingsAction(
  code: ChatErrorCode,
): boolean {
  return code === 'missing_api_key' || code === 'auth_error';
}

/** Show the disclosure whenever the full raw text says more than the body —
 * including generic failures, whose body is only the one-line summary. */
export function builderShowsTechnicalDetails(
  sanitized: SanitizedChatError,
  body: string,
): boolean {
  return (
    sanitized.rawMessage !== undefined &&
    sanitized.rawMessage.length > 0 &&
    sanitized.rawMessage !== body
  );
}

export function classifyBuilderFailureCode(raw: string): ChatErrorCode {
  return classifyChatErrorCode(normalizeBuilderReason(raw));
}

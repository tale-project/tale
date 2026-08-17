/**
 * Single source of truth for chat-generation error classification, shared by
 * the Convex backend (which classifies the real provider/SDK error object) and
 * the React chat UI (which renders a localized, actionable message).
 *
 * The backend stamps a structured, machine-readable code onto the failed
 * message via {@link encodeChatError}; the client reads it back authoritatively
 * via {@link decodeChatError} instead of re-deriving the category by regex.
 * Errors that predate the envelope (or come from a non-chat path) decode to
 * `{ raw }`, and the client falls back to {@link classifyChatErrorCode} over
 * the raw string — so the contract degrades gracefully.
 *
 * Pure module: no Node, no Convex, no React imports — safe in both the V8
 * Convex runtime and the browser bundle.
 */

/**
 * The machine marker the retired external-agent stop path wrote as the
 * message's `blockedReason`. No live path writes it anymore (chat is
 * plain-conversation-only, #2877), but stored rows still carry it — a value,
 * not a sentence, so the UI localizes it via {@link isStoppedReason}.
 */
const CHAT_STOPPED_MARKER = 'TALE_STOPPED';

/** The pre-marker English sentence the external stop path used to write. */
const LEGACY_STOPPED_SENTENCE = 'You stopped this response.';

/** Whether a stored `blockedReason` means "the user stopped this reply". */
export function isStoppedReason(reason: string | undefined): boolean {
  return reason === CHAT_STOPPED_MARKER || reason === LEGACY_STOPPED_SENTENCE;
}

export const CHAT_ERROR_CODES = [
  'missing_api_key',
  'credit_exhausted',
  'auth_error',
  'model_not_found',
  'unsupported_parameter',
  'output_cap_too_high',
  'token_limit',
  'rate_limited',
  'content_filter',
  'context_length',
  'tool_failure',
  'provider_unreachable',
  'provider_error',
  'generic',
] as const;

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];

export function isChatErrorCode(value: unknown): value is ChatErrorCode {
  return (
    typeof value === 'string' &&
    (CHAT_ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * Codes that are a property of the PROVIDER/account, not the specific model:
 * every model on the same provider would fail the same way deterministically.
 * The failover loop skips the rest of the provider's models when one of these
 * occurs (see `classifyFailureScope` in convex/providers/errors.ts).
 *
 * Transient failures (5xx, overload, timeout, ECONNRESET, 429) are deliberately
 * NOT here: on an aggregator a sibling model may route to a healthy upstream,
 * and the circuit breaker already de-prioritizes repeat offenders.
 */
export const PROVIDER_SCOPED_ERROR_CODES: ReadonlySet<ChatErrorCode> = new Set([
  'credit_exhausted',
  'auth_error',
  'provider_unreachable',
]);

/** Code → base chat i18n key (in the `chat` namespace). */
export const CHAT_ERROR_I18N_KEY: Readonly<Record<ChatErrorCode, string>> = {
  missing_api_key: 'errorHintMissingApiKey',
  credit_exhausted: 'errorHintCreditExhausted',
  auth_error: 'errorHintAuthError',
  model_not_found: 'errorHintModelNotFound',
  unsupported_parameter: 'errorHintUnsupportedParameter',
  output_cap_too_high: 'errorHintOutputCapTooHigh',
  token_limit: 'errorHintTokenLimit',
  rate_limited: 'errorHintRateLimited',
  content_filter: 'errorHintContentFilter',
  context_length: 'errorHintContextLength',
  tool_failure: 'errorHintToolFailure',
  provider_unreachable: 'errorHintProviderUnreachable',
  provider_error: 'errorHintProviderError',
  generic: 'errorGeneratingDescription',
};

/**
 * Richer "named" i18n variant used when the failing provider/model is known.
 * Falls back to {@link CHAT_ERROR_I18N_KEY} when no name is available. Only the
 * codes where a name materially helps the user have one.
 */
export const CHAT_ERROR_I18N_KEY_NAMED: Readonly<
  Partial<Record<ChatErrorCode, string>>
> = {
  credit_exhausted: 'errorHintCreditExhaustedNamed',
  auth_error: 'errorHintAuthErrorNamed',
  provider_unreachable: 'errorHintProviderUnreachableNamed',
  model_not_found: 'errorHintModelNotFoundNamed',
  rate_limited: 'errorHintRateLimitedNamed',
};

interface ErrorFacts {
  status?: number;
  code?: string;
  message: string;
}

function extractErrorFacts(error: unknown): ErrorFacts {
  if (typeof error === 'string') return { message: error.toLowerCase() };
  if (error === null || typeof error !== 'object') return { message: '' };

  const err = error as Record<string, unknown>;
  const status =
    typeof err.status === 'number'
      ? err.status
      : typeof err.statusCode === 'number'
        ? err.statusCode
        : undefined;
  const code = typeof err.code === 'string' ? err.code : undefined;
  const message = typeof err.message === 'string' ? err.message : '';
  return { status, code, message: message.toLowerCase() };
}

/**
 * Classify a provider/SDK error (object OR raw string) into a {@link ChatErrorCode}.
 *
 * Order is significant — the most specific patterns win. This is the merged,
 * canonical version of the previously-duplicated backend status logic and the
 * client regex matcher.
 */
export function classifyChatErrorCode(error: unknown): ChatErrorCode {
  const { status, code, message } = extractErrorFacts(error);

  // Org has no usable provider / no API key at all — actionable setup error.
  if (
    /noprovideravailableerror|missingapikeyerror|no api key is configured for this organization/i.test(
      message,
    )
  ) {
    return 'missing_api_key';
  }

  // Out of funds — account-level, every model on the provider fails the same.
  if (
    status === 402 ||
    /more credits|can only afford|credit.*insufficient|insufficient.*credit|never purchased credits|credit.*(limit|reached)|\b402\b/i.test(
      message,
    )
  ) {
    return 'credit_exhausted';
  }

  // Invalid / expired / unauthorized key — bad for the whole provider.
  if (
    status === 401 ||
    status === 403 ||
    /\b401\b|\b403\b|invalid.*key|expired.*key|api.?key.*invalid|unauthorized|forbidden|authentication.*fail|user not found|missing.*authentication/i.test(
      message,
    )
  ) {
    return 'auth_error';
  }

  if (
    status === 404 ||
    /model.*not found|model.*not available|invalid model|\b404\b/i.test(message)
  ) {
    return 'model_not_found';
  }

  // Operator-config parameter mismatch — must precede token_limit, whose broad
  // `max_tokens` match would otherwise mislabel it. "not supported for" covers
  // OpenAI's combination rejections ("Function tools with reasoning_effort are
  // not supported for gpt-5.5 in /v1/chat/completions").
  if (
    /unsupported parameter|is not supported with this model|not supported for\b|unsupported_parameter|unknown parameter|unrecognized request argument/i.test(
      message,
    )
  ) {
    return 'unsupported_parameter';
  }

  // Configured output cap exceeds the model's real ceiling — must precede
  // token_limit for the same reason.
  if (
    /max_tokens.*too large|too large.*max_tokens|supports at most.*completion tokens|reduce.*max_tokens/i.test(
      message,
    )
  ) {
    return 'output_cap_too_high';
  }

  // OpenRouter (and similar) reject when max_tokens alone fills the whole
  // context window: "…1048576 in the output". That is an output-cap misconfig,
  // not a conversation that grew too long — classify before the broad
  // context_length matcher below.
  if (
    /in the output\b/i.test(message) &&
    /context.?length|context.?window|maximum context/i.test(message)
  ) {
    return 'output_cap_too_high';
  }

  if (/fewer max_tokens|token.*limit|max_tokens/i.test(message)) {
    return 'token_limit';
  }

  if (/context.?length|context.?window|maximum context/i.test(message)) {
    return 'context_length';
  }

  if (
    status === 429 ||
    /rate.?limit|too many requests|\b429\b/i.test(message)
  ) {
    return 'rate_limited';
  }

  if (/content.?filter|content.?policy|moderation/i.test(message)) {
    return 'content_filter';
  }

  // Host unreachable — DNS / refused connection. Distinct from a transient
  // provider 5xx/reset below: the endpoint itself can't be reached, so every
  // model on the provider is dead. ECONNRESET/ETIMEDOUT are NOT here (transient).
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    /econnrefused|enotfound|getaddrinfo|fetch failed|dns/i.test(message)
  ) {
    return 'provider_unreachable';
  }

  if (/tool.*error|tool.*fail|unable to complete/i.test(message)) {
    return 'tool_failure';
  }

  // Transient provider trouble — server errors, overload, timeouts, resets.
  if (
    (status !== undefined && status >= 500) ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    /\b5\d{2}\b|server error|overloaded|capacity|service.?unavailable|internal.?error|timeout|timed out|econnreset|etimedout/i.test(
      message,
    )
  ) {
    return 'provider_error';
  }

  return 'generic';
}

/**
 * Build a concise, human-readable English sentence for a failed turn. Used as
 * the saved message CONTENT, which non-chat surfaces (Slack, notifications)
 * read verbatim. The chat UI ignores this and renders the localized hint from
 * the structured code instead.
 */
export function buildHumanErrorSentence(
  code: ChatErrorCode,
  ctx: { provider?: string; model?: string } = {},
): string {
  const provider = ctx.provider;
  const model = ctx.model;
  switch (code) {
    case 'missing_api_key':
      return 'No AI provider API key is configured. Add one in Settings → AI providers.';
    case 'credit_exhausted':
      return `${provider ? `${provider} is` : 'The AI provider is'} out of credits. Ask an administrator to add credits or switch providers.`;
    case 'auth_error':
      return `The API key for ${provider ?? 'the AI provider'} is invalid or expired. Ask an administrator to update it.`;
    case 'provider_unreachable':
      return `Could not reach ${provider ?? 'the AI provider'}. It may be down or misconfigured.`;
    case 'model_not_found':
      return `The model ${model ? `"${model}" ` : ''}was not found on ${provider ?? 'the provider'}. It may have been renamed or removed.`;
    case 'rate_limited':
      return `Rate limit reached${provider ? ` on ${provider}` : ''}. Please wait a moment and try again.`;
    case 'content_filter':
      return 'The request was blocked by a content filter. Try rephrasing your message.';
    case 'context_length':
      return 'The conversation is too long for the model’s context window. Start a new chat.';
    case 'token_limit':
      return 'The model’s output token limit was exceeded. Try a shorter request.';
    case 'unsupported_parameter':
      return 'The model rejected a request parameter — likely a provider or model configuration mismatch.';
    case 'output_cap_too_high':
      return "This model's max output tokens leave no room for the prompt (or exceed what it supports). Try again — a bad cached cap is cleared automatically — or ask an administrator to lower it.";
    case 'tool_failure':
      return 'The agent hit an error while accessing data. Try rephrasing your request.';
    case 'provider_error':
      return `${provider ?? 'The AI provider'} is temporarily experiencing issues. Please try again shortly.`;
    case 'generic':
      return 'An unexpected error occurred. Try again or switch to a different model.';
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

/** Structured fields carried alongside a failed chat turn's error string. */
interface ChatErrorInfo {
  code?: ChatErrorCode;
  provider?: string;
  model?: string;
  /** How many models were attempted before giving up. */
  triedCount?: number;
  /** The verbatim provider/SDK error, for the "Technical details" disclosure. */
  raw?: string;
}

const ENVELOPE_PREFIX = 'TALE_ERR1 ';

/**
 * Encode structured error facts into a single string suitable for the message
 * `error` field: a machine-only header line, then the raw provider message.
 * The header is URL-encoded JSON so field values can't collide with the
 * delimiter or contain newlines.
 */
export function encodeChatError(info: ChatErrorInfo): string {
  const header = encodeURIComponent(
    JSON.stringify({
      code: info.code,
      provider: info.provider,
      model: info.model,
      tried: info.triedCount,
    }),
  );
  return `${ENVELOPE_PREFIX}${header}\n${info.raw ?? ''}`;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/**
 * Decode a message `error` string. Returns the structured fields when the
 * envelope header is present; otherwise `{ raw: <original> }` so legacy /
 * non-chat errors still surface their raw text for client-side fallback.
 */
export function decodeChatError(error: string | undefined): ChatErrorInfo {
  if (!error) return {};
  const newlineIdx = error.indexOf('\n');
  const firstLine = newlineIdx >= 0 ? error.slice(0, newlineIdx) : error;
  if (!firstLine.startsWith(ENVELOPE_PREFIX)) {
    return { raw: error };
  }
  const rawTail = newlineIdx >= 0 ? error.slice(newlineIdx + 1) : '';
  try {
    const parsed: unknown = JSON.parse(
      decodeURIComponent(firstLine.slice(ENVELOPE_PREFIX.length)),
    );
    if (parsed === null || typeof parsed !== 'object') {
      return { raw: error };
    }
    const fields = parsed as Record<string, unknown>;
    return {
      code: isChatErrorCode(fields.code) ? fields.code : undefined,
      provider: asString(fields.provider),
      model: asString(fields.model),
      triedCount: asPositiveInt(fields.tried),
      raw: rawTail.length > 0 ? rawTail : undefined,
    };
  } catch {
    // Malformed header — treat the whole thing as raw text.
    return { raw: error };
  }
}

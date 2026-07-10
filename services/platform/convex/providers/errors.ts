import {
  classifyChatErrorCode,
  PROVIDER_SCOPED_ERROR_CODES,
} from '../../lib/shared/chat-errors';

/**
 * Typed error for provider unavailability (HTTP 429, 502, 503, timeout).
 *
 * Thrown by the response generator when a provider fails with a transient
 * error. The caller can catch this to trigger circuit-breaker recording
 * and failover resolution.
 */

export class ProviderUnavailableError extends Error {
  readonly provider: string;
  readonly model: string;
  readonly statusCode?: number;

  constructor(
    message: string,
    provider: string,
    model: string,
    statusCode?: number,
  ) {
    super(message);
    this.name = 'ProviderUnavailableError';
    this.provider = provider;
    this.model = model;
    this.statusCode = statusCode;
  }
}

/**
 * User-facing error thrown when no usable AI provider can be loaded for an
 * org. The condition is org-wide — every fallback model would hit the same
 * empty provider list — so callers should treat this as terminal and not
 * walk the fallback chain.
 */
export class NoProviderAvailableError extends Error {
  readonly reason: 'missing_api_key' | 'no_providers' | 'load_failed';
  readonly details: string[];
  constructor(
    message: string,
    reason: 'missing_api_key' | 'no_providers' | 'load_failed',
    details: string[] = [],
  ) {
    super(message);
    this.name = 'NoProviderAvailableError';
    this.reason = reason;
    this.details = details;
  }
}

/**
 * Thrown when a specific model cannot resolve an API key (issue #1711): no
 * env-var source (`secretsEnv` unset/empty/not prefixed) and no file key.
 *
 * Unlike {@link NoProviderAvailableError}, this is PER-MODEL — a provider may be
 * loaded because a sibling model has an env key while this one has none — so it
 * is intentionally **failover-eligible**: a different fallback model on another
 * provider may have a valid key. See {@link shouldFailoverToNextModel}.
 */
export class MissingApiKeyError extends Error {
  readonly provider: string;
  readonly model: string;
  readonly secretsEnv?: string;
  constructor(provider: string, model: string, secretsEnv?: string) {
    super(
      secretsEnv
        ? `No API key for model "${model}" on provider "${provider}": ` +
            `secretsEnv "${secretsEnv}" is empty, unset, or does not start with ` +
            `the reserved prefix TALE_PROVIDER_KEY_, and no file key is configured.`
        : `No API key configured for model "${model}" on provider "${provider}".`,
    );
    this.name = 'MissingApiKeyError';
    this.provider = provider;
    this.model = model;
    this.secretsEnv = secretsEnv;
  }
}

/**
 * User-facing copy for "this org has no usable AI provider". Shared by the
 * provider loader (which throws {@link NoProviderAvailableError} eagerly) and
 * the agent fallback chain (which collapses an all-unconfigured chain into the
 * same actionable error — see {@link buildChainExhaustionError}). One sentence,
 * one source of truth so the two paths can never drift.
 */
export const FRIENDLY_NO_PROVIDER =
  'No API key is configured for this organization yet. Open Settings → AI providers and add one to start chatting.';

const TRANSIENT_STATUS_CODES = new Set([429, 502, 503, 504]);

/**
 * Check if an error represents a transient provider failure that should
 * trigger failover. Returns provider/model metadata if so, or null.
 */
export function isTransientProviderError(error: unknown): {
  statusCode?: number;
  isTimeout: boolean;
} | null {
  if (error === null || error === undefined) return null;

  const isObject = (val: unknown): val is Record<string, unknown> =>
    val !== null && typeof val === 'object';

  const err = isObject(error) ? error : {};

  const status =
    typeof err.status === 'number'
      ? err.status
      : typeof err.statusCode === 'number'
        ? err.statusCode
        : undefined;

  if (status !== undefined && TRANSIENT_STATUS_CODES.has(status)) {
    return { statusCode: status, isTimeout: false };
  }

  const message = (
    typeof err.message === 'string' ? err.message : ''
  ).toLowerCase();
  const code = typeof err.code === 'string' ? err.code : undefined;

  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED'
  ) {
    return { statusCode: status, isTimeout: true };
  }

  if (
    message.includes('overloaded') ||
    message.includes('capacity') ||
    message.includes('rate limit')
  ) {
    return { statusCode: status, isTimeout: false };
  }

  return null;
}

/**
 * Provider-specific HTTP status codes that indicate the error is tied to a
 * particular provider/model configuration (e.g. invalid API key, model not
 * found) rather than a universal problem. A different fallback model on a
 * different provider may succeed.
 */
const PROVIDER_SPECIFIC_STATUS_CODES = new Set([400, 401, 402, 403, 404]);

/**
 * Message patterns indicating the error would fail on ANY model and therefore
 * should NOT trigger failover. Checked case-insensitively.
 */
const NO_FAILOVER_PATTERNS = [
  'content_policy',
  'content policy',
  'content_filter',
  'content filter',
  'moderation',
  'context_length',
  'maximum context length',
  'context window',
  // Image-input rejections that fail on any vision model deterministically.
  'image format',
  'unsupported format',
  'unsupported image',
  'invalid image',
];

/**
 * Message patterns indicating the error is a model/provider resolution failure
 * that a different fallback model may resolve.
 */
const RESOLUTION_ERROR_PATTERNS = [
  'not found',
  'no model',
  'no provider',
  'failed to load',
];

/**
 * Determines whether an error should trigger agent-level failover to the next
 * model in the fallback chain.
 *
 * This is intentionally **broader** than {@link isTransientProviderError}:
 * transient errors (429, 5xx, timeouts) always qualify, but so do
 * provider-specific errors (401 auth, 404 model-not-found) because a different
 * fallback model may use a completely different provider with valid credentials.
 *
 * Errors that would fail on ANY model (content policy violations, context
 * length exceeded) return `false` to avoid wasting fallback attempts.
 */
export function shouldFailoverToNextModel(error: unknown): boolean {
  if (error === null || error === undefined) return false;

  // Extract properties from the error object.
  const isObject = (val: unknown): val is Record<string, unknown> =>
    val !== null && typeof val === 'object';

  const err = isObject(error) ? error : {};

  const status =
    typeof err.status === 'number'
      ? err.status
      : typeof err.statusCode === 'number'
        ? err.statusCode
        : undefined;

  const message = (
    typeof err.message === 'string' ? err.message : ''
  ).toLowerCase();

  // Org has no usable provider at all — every fallback model would hit the
  // same empty provider list. Surface the actionable error immediately
  // instead of walking the chain. Match by class name AND by message
  // pattern: Convex's ctx.runAction() reserializes thrown errors as plain
  // Error whose message is prefixed "Uncaught NoProviderAvailableError: ...",
  // so `instanceof` alone misses cross-action throws.
  if (
    error instanceof NoProviderAvailableError ||
    message.includes('noprovideravailableerror')
  ) {
    return false;
  }

  // A per-model missing API key (issue #1711) IS failoverable — a different
  // fallback model on another provider may have a valid key. Classify it
  // explicitly (rather than leaning on the conservative default) so a future
  // NO_FAILOVER_PATTERNS addition can't accidentally make it terminal. Match
  // by class and by the reserialized cross-action message prefix.
  if (
    error instanceof MissingApiKeyError ||
    message.includes('missingapikeyerror')
  ) {
    return true;
  }

  // All transient errors are failoverable (superset).
  if (isTransientProviderError(error) !== null) return true;

  // Explicit provider-unavailable errors always qualify.
  if (error instanceof ProviderUnavailableError) return true;

  // Output-cap misconfig (including OpenRouter's "… in the output" shape that
  // also mentions context length) is model/config-scoped — another model, or
  // the same model after the poisoned cache row is cleared, may succeed.
  if (classifyChatErrorCode(error) === 'output_cap_too_high') return true;

  // Exclude universal errors that would fail on any model.
  if (NO_FAILOVER_PATTERNS.some((p) => message.includes(p))) return false;

  // Provider-specific HTTP status codes — a different provider may succeed.
  if (status !== undefined && PROVIDER_SPECIFIC_STATUS_CODES.has(status)) {
    return true;
  }

  // Model/provider resolution errors (plain Error, no HTTP status).
  if (RESOLUTION_ERROR_PATTERNS.some((p) => message.includes(p))) return true;

  // Conservative default: try the fallback for unrecognised errors.
  return true;
}

/**
 * Failure scope: how widely a model failure should suppress retries.
 *
 * - `'terminal'`  — would fail on ANY model (content policy, context length,
 *   no provider configured). Don't fall over at all. Equivalent to
 *   `!shouldFailoverToNextModel(error)`.
 * - `'provider'`  — a DETERMINISTIC property of the provider/account (out of
 *   funds, invalid API key, host unreachable). Every model on that provider
 *   would fail the same way, so the fallback loop skips the rest of the
 *   provider's models and jumps to a model on a different provider.
 * - `'model'`     — specific to this model OR transient (404 not-found, 429,
 *   5xx, timeout, reset, missing per-model key). Try the next model in line,
 *   even on the same provider — a sibling may succeed.
 *
 * The provider-scoped set lives in `lib/shared/chat-errors` so the backend
 * failover decision and the client-facing error code stay in lockstep.
 */
export function classifyFailureScope(
  error: unknown,
): 'terminal' | 'provider' | 'model' {
  if (!shouldFailoverToNextModel(error)) return 'terminal';
  return PROVIDER_SCOPED_ERROR_CODES.has(classifyChatErrorCode(error))
    ? 'provider'
    : 'model';
}

/**
 * Pick the terminal error to surface when the agent fallback chain is exhausted
 * without any model producing a response (issue #1455).
 *
 * - `attemptedCount > 0` — at least one model reached a live provider call, so
 *   the last caught error (a transient/runtime failure) is the genuine cause
 *   and is surfaced unchanged.
 * - `attemptedCount === 0` — NO model ever reached a provider; every entry
 *   failed during resolution for a configuration reason (missing API key,
 *   unconfigured model/provider). Throwing the LAST entry's per-model error
 *   misleads the user into thinking only that one model is broken, when the
 *   whole chain is unconfigured. Collapse it into a single actionable
 *   {@link NoProviderAvailableError} so the chat surface renders the "configure
 *   a provider" hint (`classifyChatErrorCode` → `missing_api_key`) instead of a
 *   confusing tail-model message. An error that is already a
 *   NoProviderAvailableError is passed through untouched.
 */
export function buildChainExhaustionError(opts: {
  attemptedCount: number;
  configFailures: ReadonlyArray<{ model: string; message: string }>;
  lastError: unknown;
}): unknown {
  const { attemptedCount, configFailures, lastError } = opts;
  const fallback = lastError ?? new Error('No model could be resolved');
  if (attemptedCount > 0) return fallback;
  if (lastError instanceof NoProviderAvailableError) return lastError;
  if (configFailures.length === 0) return fallback;
  return new NoProviderAvailableError(FRIENDLY_NO_PROVIDER, 'missing_api_key', [
    `All ${configFailures.length} model(s) in the fallback chain are unconfigured:`,
    ...configFailures.map((f) => `${f.model}: ${f.message}`),
  ]);
}

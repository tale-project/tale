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

  // All transient errors are failoverable (superset).
  if (isTransientProviderError(error) !== null) return true;

  // Explicit provider-unavailable errors always qualify.
  if (error instanceof ProviderUnavailableError) return true;

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

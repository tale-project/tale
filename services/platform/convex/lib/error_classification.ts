/**
 * Error classification utilities for retry decisions.
 *
 * Classifies errors to determine whether they should be retried.
 * This helps avoid wasting time retrying errors that won't succeed.
 */

export interface ErrorClassification {
  /** Whether the error should be retried */
  shouldRetry: boolean;
  /** Short code describing the error type */
  reason: string;
  /** Human-readable description */
  description: string;
}

/**
 * Classifies an error to determine if it should be retried.
 *
 * Non-retryable errors:
 * - Authentication/authorization errors (401, 403)
 * - Bad request / invalid input (400)
 * - Content policy violations
 * - Invalid model configuration
 * - Context length exceeded (needs summarization, not retry)
 *
 * Retryable errors:
 * - Rate limits (429)
 * - Server errors (5xx)
 * - Network/connection errors
 * - Overloaded/capacity issues
 */
export function classifyError(error: unknown): ErrorClassification {
  // Type-safe property access for unknown error objects
  const isObject = (val: unknown): val is Record<string, unknown> =>
    val !== null && typeof val === 'object';

  const err = isObject(error) ? error : {};
  const message = String(err.message ?? '').toLowerCase();
  const status =
    typeof err.status === 'number'
      ? err.status
      : typeof err.statusCode === 'number'
        ? err.statusCode
        : undefined;
  const code = typeof err.code === 'string' ? err.code : undefined;

  // Authentication/authorization errors - won't succeed on retry
  if (status === 401 || status === 403) {
    return {
      shouldRetry: false,
      reason: 'auth_error',
      description: 'Authentication or authorization failed',
    };
  }

  // Bad request - likely invalid input that won't change
  if (status === 400) {
    return {
      shouldRetry: false,
      reason: 'bad_request',
      description: 'Invalid request parameters',
    };
  }

  // Not found - resource doesn't exist
  if (status === 404) {
    return {
      shouldRetry: false,
      reason: 'not_found',
      description: 'Resource not found',
    };
  }

  // Content policy violations - won't change on retry
  if (message.includes('content_policy') || message.includes('content policy')) {
    return {
      shouldRetry: false,
      reason: 'content_policy',
      description: 'Content policy violation',
    };
  }

  // Model not found or invalid - configuration issue
  if (message.includes('model not found') || message.includes('invalid model')) {
    return {
      shouldRetry: false,
      reason: 'invalid_model',
      description: 'Invalid or unavailable model',
    };
  }

  // Context length exceeded - needs summarization, not retry
  if (
    message.includes('context_length') ||
    message.includes('maximum context length') ||
    message.includes('context window')
  ) {
    return {
      shouldRetry: false,
      reason: 'context_length_exceeded',
      description: 'Context length exceeded - conversation needs summarization',
    };
  }

  // Rate limits - should retry with backoff
  if (status === 429 || message.includes('rate limit')) {
    return {
      shouldRetry: true,
      reason: 'rate_limit',
      description: 'Rate limit exceeded - will retry with backoff',
    };
  }

  // Server errors - temporary, should retry
  if (status !== undefined && status >= 500 && status < 600) {
    return {
      shouldRetry: true,
      reason: 'server_error',
      description: 'Server error - will retry',
    };
  }

  // Network/connection errors - temporary, should retry
  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('socket') ||
    message.includes('fetch failed')
  ) {
    return {
      shouldRetry: true,
      reason: 'network_error',
      description: 'Network error - will retry',
    };
  }

  // Timeout errors - may succeed on retry
  if (message.includes('timeout') || message.includes('timed out')) {
    return {
      shouldRetry: true,
      reason: 'timeout',
      description: 'Operation timed out - will retry',
    };
  }

  // Overloaded/capacity issues - temporary, should retry
  if (message.includes('overloaded') || message.includes('capacity')) {
    return {
      shouldRetry: true,
      reason: 'overloaded',
      description: 'Service overloaded - will retry',
    };
  }

  // Default: retry unknown errors (conservative approach)
  return {
    shouldRetry: true,
    reason: 'unknown',
    description: 'Unknown error - will retry',
  };
}

/**
 * Custom error class for non-retryable errors.
 *
 * When thrown, this signals to the caller that the operation should not
 * be retried. The action-retrier will see this failure and may still retry
 * unless you handle it at a higher level.
 *
 * Usage:
 * ```ts
 * const classification = classifyError(error);
 * if (!classification.shouldRetry) {
 *   throw new NonRetryableError(
 *     classification.description,
 *     error,
 *     classification.reason,
 *   );
 * }
 * throw error; // Let retrier handle it
 * ```
 */
export class NonRetryableError extends Error {
  readonly isNonRetryable = true;
  readonly originalError: unknown;
  readonly errorReason: string;

  constructor(message: string, originalError: unknown, reason: string) {
    super(message);
    this.name = 'NonRetryableError';
    this.originalError = originalError;
    this.errorReason = reason;
  }
}

/**
 * Wraps an error based on its classification.
 * Non-retryable errors are wrapped in NonRetryableError.
 * Retryable errors are returned as-is.
 */
export function wrapErrorForRetry(error: unknown): Error {
  const classification = classifyError(error);

  if (!classification.shouldRetry) {
    return new NonRetryableError(
      classification.description,
      error,
      classification.reason,
    );
  }

  // Return original error for retryable cases
  return error instanceof Error ? error : new Error(String(error));
}

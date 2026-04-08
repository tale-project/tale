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

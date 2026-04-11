import { describe, expect, it } from 'vitest';

import {
  classifyError,
  classifyProviderError,
  NonRetryableError,
} from './error_classification';

describe('classifyError', () => {
  it('classifies 400 as non-retryable bad_request', () => {
    const result = classifyError({ status: 400, message: 'Bad request' });
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toBe('bad_request');
  });

  it('classifies 401 as non-retryable auth_error', () => {
    const result = classifyError({ status: 401, message: 'Unauthorized' });
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toBe('auth_error');
  });

  it('classifies 403 as non-retryable auth_error', () => {
    const result = classifyError({ status: 403, message: 'Forbidden' });
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toBe('auth_error');
  });

  it('classifies 404 as non-retryable not_found', () => {
    const result = classifyError({ status: 404, message: 'Not found' });
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toBe('not_found');
  });

  it('classifies 429 as retryable rate_limit', () => {
    const result = classifyError({ status: 429, message: 'Too many requests' });
    expect(result.shouldRetry).toBe(true);
    expect(result.reason).toBe('rate_limit');
  });

  it('classifies 502 as retryable server_error', () => {
    const result = classifyError({ status: 502, message: 'Bad gateway' });
    expect(result.shouldRetry).toBe(true);
    expect(result.reason).toBe('server_error');
  });

  it('classifies "model not found" message as non-retryable', () => {
    const result = classifyError({ message: 'model not found on provider' });
    expect(result.shouldRetry).toBe(false);
    expect(result.reason).toBe('invalid_model');
  });
});

describe('classifyProviderError', () => {
  it('returns model_not_found for 404 errors', () => {
    const result = classifyProviderError({
      status: 404,
      message: 'Not found',
    });
    expect(result.errorType).toBe('model_not_found');
    expect(result.userMessage).toContain('not found');
  });

  it('returns auth_failed for 401 errors', () => {
    const result = classifyProviderError({
      status: 401,
      message: 'Unauthorized',
    });
    expect(result.errorType).toBe('auth_failed');
    expect(result.userMessage).toContain('API key');
  });

  it('returns auth_failed for 403 errors', () => {
    const result = classifyProviderError({
      status: 403,
      message: 'Forbidden',
    });
    expect(result.errorType).toBe('auth_failed');
    expect(result.userMessage).toContain('access');
  });

  it('returns rate_limited for 429 errors', () => {
    const result = classifyProviderError({
      status: 429,
      message: 'Rate limit exceeded',
    });
    expect(result.errorType).toBe('rate_limited');
    expect(result.userMessage).toContain('rate limit');
  });

  it('returns bad_request for 400 errors', () => {
    const result = classifyProviderError({
      status: 400,
      message: 'Invalid request',
    });
    expect(result.errorType).toBe('bad_request');
  });

  it('returns provider_error for 500+ errors', () => {
    const result = classifyProviderError({
      status: 502,
      message: 'Bad gateway',
    });
    expect(result.errorType).toBe('provider_error');
  });

  it('returns model_not_found for "model not found" message regardless of status', () => {
    const result = classifyProviderError({
      message: 'Model "test/model" not found in any provider',
    });
    expect(result.errorType).toBe('model_not_found');
  });

  it('returns unknown for unrecognized errors', () => {
    const result = classifyProviderError({
      message: 'Something unexpected happened',
    });
    expect(result.errorType).toBe('unknown');
  });

  it('handles non-object errors gracefully', () => {
    const result = classifyProviderError('string error');
    expect(result.errorType).toBe('unknown');
  });

  it('handles null error gracefully', () => {
    const result = classifyProviderError(null);
    expect(result.errorType).toBe('unknown');
  });

  it('returns provider_error for 503 errors', () => {
    const result = classifyProviderError({
      status: 503,
      message: 'Service unavailable',
    });
    expect(result.errorType).toBe('provider_error');
    expect(result.userMessage).toContain('experiencing issues');
  });

  it('uses statusCode property when status is absent', () => {
    const result = classifyProviderError({
      statusCode: 429,
      message: 'Rate limit',
    });
    expect(result.errorType).toBe('rate_limited');
  });
});

describe('NonRetryableError', () => {
  it('preserves original error and reason', () => {
    const original = new Error('original');
    const err = new NonRetryableError('wrapped', original, 'bad_request');
    expect(err.message).toBe('wrapped');
    expect(err.originalError).toBe(original);
    expect(err.errorReason).toBe('bad_request');
    expect(err.isNonRetryable).toBe(true);
  });
});

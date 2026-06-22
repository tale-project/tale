import { describe, expect, it } from 'vitest';

import { classifyError, NonRetryableError } from './error_classification';

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

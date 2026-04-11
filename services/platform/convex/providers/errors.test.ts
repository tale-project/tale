import { describe, expect, it } from 'vitest';

import { isTransientProviderError, ProviderUnavailableError } from './errors';

describe('isTransientProviderError', () => {
  it('returns null for null/undefined', () => {
    expect(isTransientProviderError(null)).toBeNull();
    expect(isTransientProviderError(undefined)).toBeNull();
  });

  it('detects 429 as transient', () => {
    const result = isTransientProviderError({ status: 429 });
    expect(result).not.toBeNull();
    expect(result?.statusCode).toBe(429);
    expect(result?.isTimeout).toBe(false);
  });

  it('detects 502 as transient', () => {
    const result = isTransientProviderError({ status: 502 });
    expect(result).not.toBeNull();
    expect(result?.statusCode).toBe(502);
  });

  it('detects 503 as transient', () => {
    const result = isTransientProviderError({ status: 503 });
    expect(result).not.toBeNull();
  });

  it('detects 504 as transient', () => {
    const result = isTransientProviderError({ status: 504 });
    expect(result).not.toBeNull();
  });

  it('does not detect 400 as transient', () => {
    expect(isTransientProviderError({ status: 400 })).toBeNull();
  });

  it('does not detect 401 as transient', () => {
    expect(isTransientProviderError({ status: 401 })).toBeNull();
  });

  it('does not detect 404 as transient', () => {
    expect(isTransientProviderError({ status: 404 })).toBeNull();
  });

  it('detects timeout messages', () => {
    const result = isTransientProviderError({ message: 'Request timed out' });
    expect(result).not.toBeNull();
    expect(result?.isTimeout).toBe(true);
  });

  it('detects ETIMEDOUT code', () => {
    const result = isTransientProviderError({ code: 'ETIMEDOUT' });
    expect(result).not.toBeNull();
    expect(result?.isTimeout).toBe(true);
  });

  it('detects rate limit messages', () => {
    const result = isTransientProviderError({
      message: 'rate limit exceeded',
    });
    expect(result).not.toBeNull();
  });

  it('detects overloaded messages', () => {
    const result = isTransientProviderError({
      message: 'server is overloaded',
    });
    expect(result).not.toBeNull();
  });
});

describe('ProviderUnavailableError', () => {
  it('stores provider and model info', () => {
    const err = new ProviderUnavailableError(
      'test error',
      'openrouter',
      'test/model',
      502,
    );
    expect(err.provider).toBe('openrouter');
    expect(err.model).toBe('test/model');
    expect(err.statusCode).toBe(502);
    expect(err.name).toBe('ProviderUnavailableError');
  });
});

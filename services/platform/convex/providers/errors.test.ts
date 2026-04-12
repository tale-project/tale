import { describe, expect, it } from 'vitest';

import {
  isTransientProviderError,
  ProviderUnavailableError,
  shouldFailoverToNextModel,
} from './errors';

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

describe('shouldFailoverToNextModel', () => {
  // --- Should NOT failover ---

  it('returns false for null/undefined', () => {
    expect(shouldFailoverToNextModel(null)).toBe(false);
    expect(shouldFailoverToNextModel(undefined)).toBe(false);
  });

  it('returns false for content_policy violation', () => {
    expect(
      shouldFailoverToNextModel({
        status: 400,
        message: 'content_policy violation',
      }),
    ).toBe(false);
  });

  it('returns false for content filter triggered', () => {
    expect(
      shouldFailoverToNextModel({
        status: 400,
        message: 'content filter triggered',
      }),
    ).toBe(false);
  });

  it('returns false for content policy (no status code)', () => {
    expect(
      shouldFailoverToNextModel({ message: 'Content policy violation' }),
    ).toBe(false);
  });

  it('returns false for moderation alert', () => {
    expect(shouldFailoverToNextModel({ message: 'moderation alert' })).toBe(
      false,
    );
  });

  it('returns false for maximum context length exceeded', () => {
    expect(
      shouldFailoverToNextModel({
        message: 'maximum context length exceeded',
      }),
    ).toBe(false);
  });

  it('returns false for context_length exceeded', () => {
    expect(
      shouldFailoverToNextModel({ message: 'context_length exceeded' }),
    ).toBe(false);
  });

  it('returns false for context window limit', () => {
    expect(
      shouldFailoverToNextModel({ message: 'context window limit reached' }),
    ).toBe(false);
  });

  // --- Should failover: transient errors (superset) ---

  it('returns true for 429 (rate limit)', () => {
    expect(shouldFailoverToNextModel({ status: 429 })).toBe(true);
  });

  it('returns true for 502 (bad gateway)', () => {
    expect(shouldFailoverToNextModel({ status: 502 })).toBe(true);
  });

  it('returns true for 503 (service unavailable)', () => {
    expect(shouldFailoverToNextModel({ status: 503 })).toBe(true);
  });

  it('returns true for timeout message', () => {
    expect(shouldFailoverToNextModel({ message: 'Request timed out' })).toBe(
      true,
    );
  });

  // --- Should failover: provider-specific errors ---

  it('returns true for 401 (invalid API key)', () => {
    expect(shouldFailoverToNextModel({ status: 401 })).toBe(true);
  });

  it('returns true for 402 (credit exhaustion)', () => {
    expect(shouldFailoverToNextModel({ status: 402 })).toBe(true);
  });

  it('returns true for 403 (authorization failure)', () => {
    expect(shouldFailoverToNextModel({ status: 403 })).toBe(true);
  });

  it('returns true for 404 (model not found via HTTP)', () => {
    expect(shouldFailoverToNextModel({ status: 404 })).toBe(true);
  });

  it('returns true for 400 (provider-specific validation)', () => {
    expect(
      shouldFailoverToNextModel({
        status: 400,
        message: 'invalid parameter: temperature',
      }),
    ).toBe(true);
  });

  // --- Should failover: resolution errors (plain Error, no status) ---

  it('returns true for "Model not found in any provider"', () => {
    expect(
      shouldFailoverToNextModel({
        message: 'Model "gpt-5" not found in any provider',
      }),
    ).toBe(true);
  });

  it('returns true for "No model with tag"', () => {
    expect(
      shouldFailoverToNextModel({
        message: 'No model with tag "chat" found',
      }),
    ).toBe(true);
  });

  it('returns true for "Provider not found"', () => {
    expect(
      shouldFailoverToNextModel({
        message: 'Provider "openai" not found. Available: anthropic',
      }),
    ).toBe(true);
  });

  it('returns true for "All providers failed to load"', () => {
    expect(
      shouldFailoverToNextModel({
        message: 'All 2 provider(s) failed to load',
      }),
    ).toBe(true);
  });

  // --- Should failover: explicit provider error ---

  it('returns true for ProviderUnavailableError', () => {
    expect(
      shouldFailoverToNextModel(
        new ProviderUnavailableError('unavailable', 'openai', 'gpt-4', 502),
      ),
    ).toBe(true);
  });

  // --- Should failover: unknown error (conservative default) ---

  it('returns true for unknown errors', () => {
    expect(shouldFailoverToNextModel(new Error('some unknown error'))).toBe(
      true,
    );
  });

  it('returns true for plain objects with no recognisable pattern', () => {
    expect(shouldFailoverToNextModel({ foo: 'bar' })).toBe(true);
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

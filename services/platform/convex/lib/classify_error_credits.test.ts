import { describe, it, expect } from 'vitest';

import { classifyError } from './error_classification';

describe('classifyError', () => {
  describe('credit exhaustion errors', () => {
    it('classifies HTTP 402 as credit_exhausted', () => {
      const result = classifyError({
        status: 402,
        message: 'Payment required',
      });
      expect(result).toEqual({
        shouldRetry: false,
        reason: 'credit_exhausted',
        description: 'Provider credit limit reached',
      });
    });

    it('classifies "more credits" message as credit_exhausted', () => {
      const result = classifyError({
        message:
          'This request requires more credits. You requested up to 65536 tokens.',
      });
      expect(result).toEqual({
        shouldRetry: false,
        reason: 'credit_exhausted',
        description: 'Provider credit limit reached',
      });
    });

    it('classifies "can only afford" message as credit_exhausted', () => {
      const result = classifyError({
        message: 'can only afford 23255 tokens',
      });
      expect(result).toEqual({
        shouldRetry: false,
        reason: 'credit_exhausted',
        description: 'Provider credit limit reached',
      });
    });

    it('classifies credit insufficient message as credit_exhausted', () => {
      const result = classifyError({
        message: 'Credit insufficient for this request',
      });
      expect(result).toEqual({
        shouldRetry: false,
        reason: 'credit_exhausted',
        description: 'Provider credit limit reached',
      });
    });
  });

  describe('existing classifications remain unchanged', () => {
    it('classifies 401 as auth_error', () => {
      const result = classifyError({ status: 401 });
      expect(result.reason).toBe('auth_error');
      expect(result.shouldRetry).toBe(false);
    });

    it('classifies 429 as rate_limit', () => {
      const result = classifyError({ status: 429 });
      expect(result.reason).toBe('rate_limit');
      expect(result.shouldRetry).toBe(true);
    });

    it('classifies 500 as server_error', () => {
      const result = classifyError({ status: 500 });
      expect(result.reason).toBe('server_error');
      expect(result.shouldRetry).toBe(true);
    });

    it('classifies content policy as non-retryable', () => {
      const result = classifyError({ message: 'content policy violation' });
      expect(result.reason).toBe('content_policy');
      expect(result.shouldRetry).toBe(false);
    });

    it('classifies context length as non-retryable', () => {
      const result = classifyError({
        message: 'maximum context length exceeded',
      });
      expect(result.reason).toBe('context_length_exceeded');
      expect(result.shouldRetry).toBe(false);
    });

    it('classifies output-budget-in-context as output_cap_too_high', () => {
      const result = classifyError({
        message:
          "This endpoint's maximum context length is 1048576 tokens. However, you requested about 1064907 tokens (3270 of text input, 13061 of tool input, 1048576 in the output).",
      });
      expect(result.reason).toBe('output_cap_too_high');
      expect(result.shouldRetry).toBe(false);
    });

    it('classifies unknown errors as retryable', () => {
      const result = classifyError({ message: 'something went wrong' });
      expect(result.reason).toBe('unknown');
      expect(result.shouldRetry).toBe(true);
    });

    it('classifies agent timeout as non-retryable', () => {
      const result = classifyError({ isTimeout: true });
      expect(result.reason).toBe('agent_timeout_recovered');
      expect(result.shouldRetry).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles empty object gracefully', () => {
      const result = classifyError({});
      expect(result.reason).toBe('unknown');
      expect(result.shouldRetry).toBe(true);
    });

    it('handles empty message gracefully', () => {
      const result = classifyError({ message: '' });
      expect(result.reason).toBe('unknown');
      expect(result.shouldRetry).toBe(true);
    });
  });
});

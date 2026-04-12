import { describe, it, expect } from 'vitest';

import { sanitizeChatError } from '../sanitize-chat-error';

describe('sanitizeChatError', () => {
  it('returns generic when rawError is undefined', () => {
    expect(sanitizeChatError(undefined)).toEqual({
      category: 'generic',
      i18nKey: 'errorGeneratingDescription',
    });
  });

  it('returns generic when rawError is empty string', () => {
    expect(sanitizeChatError('')).toEqual({
      category: 'generic',
      i18nKey: 'errorGeneratingDescription',
    });
  });

  it('returns generic with rawMessage for unknown error messages', () => {
    expect(sanitizeChatError('Something unexpected happened')).toEqual({
      category: 'generic',
      i18nKey: 'errorGeneratingDescription',
      rawMessage: 'Something unexpected happened',
    });
  });

  describe('credit exhausted errors', () => {
    it('matches OpenRouter credit error', () => {
      const raw =
        'Uncaught Error: This request requires more credits. You requested up to 65536 tokens, but can only afford 23255.';
      expect(sanitizeChatError(raw)).toEqual({
        category: 'creditExhausted',
        i18nKey: 'errorHintCreditExhausted',
      });
    });

    it('matches "can only afford" phrasing', () => {
      expect(sanitizeChatError('can only afford 500 tokens')).toEqual({
        category: 'creditExhausted',
        i18nKey: 'errorHintCreditExhausted',
      });
    });

    it('matches credit insufficient error', () => {
      expect(sanitizeChatError('Credit insufficient for request')).toEqual({
        category: 'creditExhausted',
        i18nKey: 'errorHintCreditExhausted',
      });
    });

    it('matches "Insufficient credits" phrasing', () => {
      expect(
        sanitizeChatError(
          'Insufficient credits. This account never purchased credits. Make sure your key is on the correct account or org.',
        ),
      ).toEqual({
        category: 'creditExhausted',
        i18nKey: 'errorHintCreditExhausted',
      });
    });

    it('matches "never purchased credits" phrasing', () => {
      expect(sanitizeChatError('This account never purchased credits')).toEqual(
        {
          category: 'creditExhausted',
          i18nKey: 'errorHintCreditExhausted',
        },
      );
    });

    it('matches HTTP 402 error', () => {
      expect(sanitizeChatError('Error 402: payment required')).toEqual({
        category: 'creditExhausted',
        i18nKey: 'errorHintCreditExhausted',
      });
    });

    it('matches backend "Provider credit limit reached" message', () => {
      expect(sanitizeChatError('Provider credit limit reached')).toEqual({
        category: 'creditExhausted',
        i18nKey: 'errorHintCreditExhausted',
      });
    });

    it('does not false-positive on numbers containing 402', () => {
      expect(sanitizeChatError('Error code 14025 encountered')).toEqual({
        category: 'generic',
        i18nKey: 'errorGeneratingDescription',
        rawMessage: 'Error code 14025 encountered',
      });
    });
  });

  describe('auth errors', () => {
    it('matches HTTP 401 error', () => {
      expect(sanitizeChatError('Error 401: unauthorized')).toEqual({
        category: 'authError',
        i18nKey: 'errorHintAuthError',
      });
    });

    it('matches HTTP 403 error', () => {
      expect(sanitizeChatError('Error 403: forbidden')).toEqual({
        category: 'authError',
        i18nKey: 'errorHintAuthError',
      });
    });

    it('matches invalid key error', () => {
      expect(sanitizeChatError('Invalid key provided for this model')).toEqual({
        category: 'authError',
        i18nKey: 'errorHintAuthError',
      });
    });

    it('matches expired key error', () => {
      expect(sanitizeChatError('Your expired key cannot be used')).toEqual({
        category: 'authError',
        i18nKey: 'errorHintAuthError',
      });
    });

    it('matches authentication failed error', () => {
      expect(
        sanitizeChatError('Authentication failed for this request'),
      ).toEqual({
        category: 'authError',
        i18nKey: 'errorHintAuthError',
      });
    });

    it('matches "User not found" error from invalid API key', () => {
      const raw = `Uncaught Error: User not found.
    at <anonymous> (../../../../node_modules/ai/src/ui/process-ui-message-stream.ts:776:14)`;
      expect(sanitizeChatError(raw)).toEqual({
        category: 'authError',
        i18nKey: 'errorHintAuthError',
      });
    });

    it('does not false-positive on numbers containing 401', () => {
      expect(sanitizeChatError('Error code 14013 encountered')).toEqual({
        category: 'generic',
        i18nKey: 'errorGeneratingDescription',
        rawMessage: 'Error code 14013 encountered',
      });
    });
  });

  describe('model not found errors', () => {
    it('matches model not found error', () => {
      expect(
        sanitizeChatError('The model was not found on this provider'),
      ).toEqual({
        category: 'modelNotFound',
        i18nKey: 'errorHintModelNotFound',
      });
    });

    it('matches model not available error', () => {
      expect(sanitizeChatError('Model gpt-5 is not available')).toEqual({
        category: 'modelNotFound',
        i18nKey: 'errorHintModelNotFound',
      });
    });

    it('matches invalid model error', () => {
      expect(sanitizeChatError('Invalid model specified')).toEqual({
        category: 'modelNotFound',
        i18nKey: 'errorHintModelNotFound',
      });
    });

    it('matches HTTP 404 error', () => {
      expect(sanitizeChatError('Error 404: not found')).toEqual({
        category: 'modelNotFound',
        i18nKey: 'errorHintModelNotFound',
      });
    });

    it('does not false-positive on numbers containing 404', () => {
      expect(sanitizeChatError('Error code 14043 encountered')).toEqual({
        category: 'generic',
        i18nKey: 'errorGeneratingDescription',
        rawMessage: 'Error code 14043 encountered',
      });
    });
  });

  describe('token limit errors', () => {
    it('matches fewer max_tokens error', () => {
      const raw =
        'This request requires fewer max_tokens. You requested up to 65536 tokens.';
      expect(sanitizeChatError(raw)).toEqual({
        category: 'tokenLimit',
        i18nKey: 'errorHintTokenLimit',
      });
    });

    it('matches token limit error', () => {
      expect(sanitizeChatError('Exceeded token limit for this model')).toEqual({
        category: 'tokenLimit',
        i18nKey: 'errorHintTokenLimit',
      });
    });

    it('matches max_tokens reference', () => {
      expect(sanitizeChatError('max_tokens exceeded')).toEqual({
        category: 'tokenLimit',
        i18nKey: 'errorHintTokenLimit',
      });
    });
  });

  describe('context length errors', () => {
    it('matches context length exceeded', () => {
      expect(sanitizeChatError('context_length exceeded')).toEqual({
        category: 'contextLength',
        i18nKey: 'errorHintContextLength',
      });
    });

    it('matches context window error', () => {
      expect(sanitizeChatError('Exceeded context window limit')).toEqual({
        category: 'contextLength',
        i18nKey: 'errorHintContextLength',
      });
    });

    it('matches maximum context length', () => {
      expect(
        sanitizeChatError('maximum context length is 128000 tokens'),
      ).toEqual({
        category: 'contextLength',
        i18nKey: 'errorHintContextLength',
      });
    });
  });

  describe('rate limit errors', () => {
    it('matches rate limit error', () => {
      expect(sanitizeChatError('Rate limit exceeded')).toEqual({
        category: 'rateLimited',
        i18nKey: 'errorHintRateLimited',
      });
    });

    it('matches "too many requests"', () => {
      expect(sanitizeChatError('Too many requests, please slow down')).toEqual({
        category: 'rateLimited',
        i18nKey: 'errorHintRateLimited',
      });
    });

    it('matches HTTP 429 reference', () => {
      expect(sanitizeChatError('Error 429: rate limited')).toEqual({
        category: 'rateLimited',
        i18nKey: 'errorHintRateLimited',
      });
    });
  });

  describe('content filter errors', () => {
    it('matches content filter error', () => {
      expect(sanitizeChatError('Content filter triggered')).toEqual({
        category: 'contentFilter',
        i18nKey: 'errorHintContentFilter',
      });
    });

    it('matches content policy error', () => {
      expect(sanitizeChatError('Violated content policy')).toEqual({
        category: 'contentFilter',
        i18nKey: 'errorHintContentFilter',
      });
    });

    it('matches moderation error', () => {
      expect(sanitizeChatError('Request flagged by moderation system')).toEqual(
        {
          category: 'contentFilter',
          i18nKey: 'errorHintContentFilter',
        },
      );
    });
  });

  describe('tool failure errors', () => {
    it('matches tool error', () => {
      expect(sanitizeChatError('Tool error: customer_read failed')).toEqual({
        category: 'toolFailure',
        i18nKey: 'errorHintToolFailure',
      });
    });

    it('matches tool failure', () => {
      expect(sanitizeChatError('Tool execution failed')).toEqual({
        category: 'toolFailure',
        i18nKey: 'errorHintToolFailure',
      });
    });

    it('matches unable to complete', () => {
      expect(
        sanitizeChatError('Unable to complete the requested operation'),
      ).toEqual({
        category: 'toolFailure',
        i18nKey: 'errorHintToolFailure',
      });
    });
  });

  describe('provider errors', () => {
    it('matches 500 server error', () => {
      expect(sanitizeChatError('Error 500: internal server error')).toEqual({
        category: 'providerError',
        i18nKey: 'errorHintProviderError',
      });
    });

    it('matches 502 bad gateway', () => {
      expect(sanitizeChatError('Error 502: bad gateway')).toEqual({
        category: 'providerError',
        i18nKey: 'errorHintProviderError',
      });
    });

    it('matches 503 service unavailable', () => {
      expect(sanitizeChatError('Error 503: service unavailable')).toEqual({
        category: 'providerError',
        i18nKey: 'errorHintProviderError',
      });
    });

    it('matches overloaded error', () => {
      expect(sanitizeChatError('The model is currently overloaded')).toEqual({
        category: 'providerError',
        i18nKey: 'errorHintProviderError',
      });
    });

    it('matches capacity error', () => {
      expect(sanitizeChatError('No capacity available for this model')).toEqual(
        {
          category: 'providerError',
          i18nKey: 'errorHintProviderError',
        },
      );
    });

    it('does not false-positive on numbers containing 500', () => {
      expect(sanitizeChatError('Processed 15003 items')).toEqual({
        category: 'generic',
        i18nKey: 'errorGeneratingDescription',
        rawMessage: 'Processed 15003 items',
      });
    });
  });

  it('does not include rawMessage for categorized errors', () => {
    const rawWithStack = `Uncaught Error: This request requires more credits.
    at <anonymous> (../../node_modules/ai/dist/index.mjs:5758:14)
    at runUpdateMessageJob (../../node_modules/ai/dist/index.mjs:8306:10)`;
    const result = sanitizeChatError(rawWithStack);
    expect(result.i18nKey).toBe('errorHintCreditExhausted');
    expect(result.rawMessage).toBeUndefined();
  });

  it('prioritizes credit exhausted over token limit for combined errors', () => {
    const raw =
      'This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 23255.';
    const result = sanitizeChatError(raw);
    expect(result.category).toBe('creditExhausted');
  });
});

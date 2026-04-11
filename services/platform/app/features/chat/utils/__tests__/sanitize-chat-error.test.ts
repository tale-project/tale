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
        rawMessage: raw,
      });
    });

    it('matches "can only afford" phrasing', () => {
      expect(sanitizeChatError('can only afford 500 tokens')).toEqual({
        category: 'creditExhausted',
        i18nKey: 'errorHintCreditExhausted',
        rawMessage: 'can only afford 500 tokens',
      });
    });

    it('matches credit insufficient error', () => {
      expect(sanitizeChatError('Credit insufficient for request')).toEqual({
        category: 'creditExhausted',
        i18nKey: 'errorHintCreditExhausted',
        rawMessage: 'Credit insufficient for request',
      });
    });

    it('matches HTTP 402 error', () => {
      expect(sanitizeChatError('Error 402: payment required')).toEqual({
        category: 'creditExhausted',
        i18nKey: 'errorHintCreditExhausted',
        rawMessage: 'Error 402: payment required',
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
        rawMessage: raw,
      });
    });

    it('matches token limit error', () => {
      expect(sanitizeChatError('Exceeded token limit for this model')).toEqual({
        category: 'tokenLimit',
        i18nKey: 'errorHintTokenLimit',
        rawMessage: 'Exceeded token limit for this model',
      });
    });

    it('matches max_tokens reference', () => {
      expect(sanitizeChatError('max_tokens exceeded')).toEqual({
        category: 'tokenLimit',
        i18nKey: 'errorHintTokenLimit',
        rawMessage: 'max_tokens exceeded',
      });
    });
  });

  describe('context length errors', () => {
    it('matches context length exceeded', () => {
      expect(sanitizeChatError('context_length exceeded')).toEqual({
        category: 'contextLength',
        i18nKey: 'errorHintContextLength',
        rawMessage: 'context_length exceeded',
      });
    });

    it('matches context window error', () => {
      expect(sanitizeChatError('Exceeded context window limit')).toEqual({
        category: 'contextLength',
        i18nKey: 'errorHintContextLength',
        rawMessage: 'Exceeded context window limit',
      });
    });

    it('matches maximum context length', () => {
      expect(
        sanitizeChatError('maximum context length is 128000 tokens'),
      ).toEqual({
        category: 'contextLength',
        i18nKey: 'errorHintContextLength',
        rawMessage: 'maximum context length is 128000 tokens',
      });
    });
  });

  describe('rate limit errors', () => {
    it('matches rate limit error', () => {
      expect(sanitizeChatError('Rate limit exceeded')).toEqual({
        category: 'rateLimited',
        i18nKey: 'errorHintRateLimited',
        rawMessage: 'Rate limit exceeded',
      });
    });

    it('matches "too many requests"', () => {
      expect(sanitizeChatError('Too many requests, please slow down')).toEqual({
        category: 'rateLimited',
        i18nKey: 'errorHintRateLimited',
        rawMessage: 'Too many requests, please slow down',
      });
    });

    it('matches HTTP 429 reference', () => {
      expect(sanitizeChatError('Error 429: rate limited')).toEqual({
        category: 'rateLimited',
        i18nKey: 'errorHintRateLimited',
        rawMessage: 'Error 429: rate limited',
      });
    });
  });

  describe('content filter errors', () => {
    it('matches content filter error', () => {
      expect(sanitizeChatError('Content filter triggered')).toEqual({
        category: 'contentFilter',
        i18nKey: 'errorHintContentFilter',
        rawMessage: 'Content filter triggered',
      });
    });

    it('matches content policy error', () => {
      expect(sanitizeChatError('Violated content policy')).toEqual({
        category: 'contentFilter',
        i18nKey: 'errorHintContentFilter',
        rawMessage: 'Violated content policy',
      });
    });

    it('matches moderation error', () => {
      expect(sanitizeChatError('Request flagged by moderation system')).toEqual(
        {
          category: 'contentFilter',
          i18nKey: 'errorHintContentFilter',
          rawMessage: 'Request flagged by moderation system',
        },
      );
    });
  });

  describe('tool failure errors', () => {
    it('matches tool error', () => {
      expect(sanitizeChatError('Tool error: customer_read failed')).toEqual({
        category: 'toolFailure',
        i18nKey: 'errorHintToolFailure',
        rawMessage: 'Tool error: customer_read failed',
      });
    });

    it('matches tool failure', () => {
      expect(sanitizeChatError('Tool execution failed')).toEqual({
        category: 'toolFailure',
        i18nKey: 'errorHintToolFailure',
        rawMessage: 'Tool execution failed',
      });
    });

    it('matches unable to complete', () => {
      expect(
        sanitizeChatError('Unable to complete the requested operation'),
      ).toEqual({
        category: 'toolFailure',
        i18nKey: 'errorHintToolFailure',
        rawMessage: 'Unable to complete the requested operation',
      });
    });
  });

  it('includes rawMessage alongside i18n key for categorized errors', () => {
    const rawWithStack = `Uncaught Error: This request requires more credits.
    at <anonymous> (../../node_modules/ai/dist/index.mjs:5758:14)
    at runUpdateMessageJob (../../node_modules/ai/dist/index.mjs:8306:10)`;
    const result = sanitizeChatError(rawWithStack);
    expect(result.i18nKey).toBe('errorHintCreditExhausted');
    expect(result.rawMessage).toBe(rawWithStack);
  });

  it('prioritizes credit exhausted over token limit for combined errors', () => {
    const raw =
      'This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 23255.';
    const result = sanitizeChatError(raw);
    expect(result.category).toBe('creditExhausted');
  });
});

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

  it('returns generic for unknown error messages', () => {
    expect(sanitizeChatError('Something unexpected happened')).toEqual({
      category: 'generic',
      i18nKey: 'errorGeneratingDescription',
    });
  });

  describe('credit/token limit errors', () => {
    it('matches OpenRouter credit error', () => {
      const raw =
        'Uncaught Error: This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 23255.';
      expect(sanitizeChatError(raw)).toEqual({
        category: 'creditLimit',
        i18nKey: 'errorHintCreditLimit',
      });
    });

    it('matches token limit error', () => {
      expect(sanitizeChatError('Exceeded token limit for this model')).toEqual({
        category: 'creditLimit',
        i18nKey: 'errorHintCreditLimit',
      });
    });

    it('matches "can only afford" phrasing', () => {
      expect(sanitizeChatError('can only afford 500 tokens')).toEqual({
        category: 'creditLimit',
        i18nKey: 'errorHintCreditLimit',
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

  it('strips stack traces by not exposing raw error', () => {
    const rawWithStack = `Uncaught Error: This request requires more credits, or fewer max_tokens.
    at <anonymous> (../../node_modules/ai/dist/index.mjs:5758:14)
    at runUpdateMessageJob (../../node_modules/ai/dist/index.mjs:8306:10)`;
    const result = sanitizeChatError(rawWithStack);
    expect(result.i18nKey).toBe('errorHintCreditLimit');
    expect(result).not.toHaveProperty('rawError');
  });
});

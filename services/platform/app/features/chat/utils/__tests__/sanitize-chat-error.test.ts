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

  describe('credit/token limit errors', () => {
    it('matches OpenRouter credit error', () => {
      const raw =
        'Uncaught Error: This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 23255.';
      expect(sanitizeChatError(raw)).toEqual({
        category: 'creditLimit',
        i18nKey: 'errorHintCreditLimit',
        rawMessage: raw,
      });
    });

    it('matches token limit error', () => {
      expect(sanitizeChatError('Exceeded token limit for this model')).toEqual({
        category: 'creditLimit',
        i18nKey: 'errorHintCreditLimit',
        rawMessage: 'Exceeded token limit for this model',
      });
    });

    it('matches "can only afford" phrasing', () => {
      expect(sanitizeChatError('can only afford 500 tokens')).toEqual({
        category: 'creditLimit',
        i18nKey: 'errorHintCreditLimit',
        rawMessage: 'can only afford 500 tokens',
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

  it('includes rawMessage alongside i18n key for categorized errors', () => {
    const rawWithStack = `Uncaught Error: This request requires more credits, or fewer max_tokens.
    at <anonymous> (../../node_modules/ai/dist/index.mjs:5758:14)
    at runUpdateMessageJob (../../node_modules/ai/dist/index.mjs:8306:10)`;
    const result = sanitizeChatError(rawWithStack);
    expect(result.i18nKey).toBe('errorHintCreditLimit');
    expect(result.rawMessage).toBe(rawWithStack);
  });
});

import { describe, expect, it } from 'vitest';

import { encodeChatError } from '@/lib/shared/chat-errors';

import { sanitizeChatError } from './sanitize-chat-error';

// Exhaustive classification coverage lives in lib/shared/chat-errors.test.ts.
// These tests cover the client adapter: envelope-authoritative decoding, named
// variant selection, and raw-detail sanitization.

describe('sanitizeChatError — legacy raw strings', () => {
  it('falls back to classifying an un-enveloped error', () => {
    const result = sanitizeChatError('Error 402: payment required');
    expect(result.code).toBe('credit_exhausted');
    expect(result.i18nKey).toBe('errorHintCreditExhausted');
    expect(result.params).toBeUndefined();
  });

  it('defaults to generic for unrecognized errors', () => {
    const result = sanitizeChatError('Something unexpected happened');
    expect(result.code).toBe('generic');
    expect(result.i18nKey).toBe('errorGeneratingDescription');
    expect(result.rawMessage).toBe('Something unexpected happened');
  });

  it('strips stack frames / paths from the raw detail', () => {
    const raw =
      'Failed after 3 attempts\n    at process (/app/node_modules/ai/x.ts:7:1)';
    const result = sanitizeChatError(raw);
    expect(result.rawMessage).toBe('Failed after 3 attempts');
    expect(result.rawMessage).not.toContain('node_modules');
  });

  it('drops the raw detail entirely when only a stack frame is present', () => {
    const result = sanitizeChatError(
      'at Object.<anonymous> (/app/node_modules/ai/index.js:1:1)',
    );
    expect(result.rawMessage).toBeUndefined();
  });
});

describe('sanitizeChatError — structured envelope (authoritative)', () => {
  it('trusts the backend code over what the raw text would classify as', () => {
    // Raw text looks like a 500, but the backend stamped credit_exhausted.
    const encoded = encodeChatError({
      code: 'credit_exhausted',
      provider: 'OpenRouter',
      raw: 'HTTP 500 from upstream',
    });
    const result = sanitizeChatError(encoded);
    expect(result.code).toBe('credit_exhausted');
    expect(result.rawMessage).toBe('HTTP 500 from upstream');
  });

  it('selects the named variant and passes params when a provider is known', () => {
    const encoded = encodeChatError({
      code: 'credit_exhausted',
      provider: 'OpenRouter',
      raw: 'requires more credits',
    });
    const result = sanitizeChatError(encoded);
    expect(result.i18nKey).toBe('errorHintCreditExhaustedNamed');
    expect(result.params).toEqual({ provider: 'OpenRouter', model: undefined });
  });

  it('uses the base variant when no provider/model is available', () => {
    const encoded = encodeChatError({
      code: 'credit_exhausted',
      raw: 'requires more credits',
    });
    const result = sanitizeChatError(encoded);
    expect(result.i18nKey).toBe('errorHintCreditExhausted');
    expect(result.params).toBeUndefined();
  });

  it('passes the model name for model_not_found', () => {
    const encoded = encodeChatError({
      code: 'model_not_found',
      provider: 'OpenRouter',
      model: 'anthropic/claude-opus-4.8',
      raw: 'model not found',
    });
    const result = sanitizeChatError(encoded);
    expect(result.i18nKey).toBe('errorHintModelNotFoundNamed');
    expect(result.params?.model).toBe('anthropic/claude-opus-4.8');
  });

  it('surfaces triedCount only when more than one model was attempted', () => {
    const many = sanitizeChatError(
      encodeChatError({ code: 'provider_error', triedCount: 3, raw: 'x' }),
    );
    expect(many.triedCount).toBe(3);
    const one = sanitizeChatError(
      encodeChatError({ code: 'provider_error', triedCount: 1, raw: 'x' }),
    );
    expect(one.triedCount).toBeUndefined();
  });
});

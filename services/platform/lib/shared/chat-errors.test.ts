import { describe, expect, it } from 'vitest';

import {
  buildHumanErrorSentence,
  CHAT_ERROR_CODES,
  CHAT_ERROR_I18N_KEY,
  classifyChatErrorCode,
  decodeChatError,
  encodeChatError,
  isChatErrorCode,
  PROVIDER_SCOPED_ERROR_CODES,
} from './chat-errors';

describe('classifyChatErrorCode', () => {
  it('classifies funds errors by status and by message', () => {
    expect(classifyChatErrorCode({ status: 402 })).toBe('credit_exhausted');
    expect(
      classifyChatErrorCode({ message: 'This request requires more credits' }),
    ).toBe('credit_exhausted');
    expect(
      classifyChatErrorCode({ message: 'You can only afford 10 tokens' }),
    ).toBe('credit_exhausted');
  });

  it('classifies auth errors by 401/403 and message', () => {
    expect(classifyChatErrorCode({ status: 401 })).toBe('auth_error');
    expect(classifyChatErrorCode({ status: 403 })).toBe('auth_error');
    expect(classifyChatErrorCode({ message: 'invalid api key' })).toBe(
      'auth_error',
    );
  });

  it('classifies model-not-found by 404 and message', () => {
    expect(classifyChatErrorCode({ status: 404 })).toBe('model_not_found');
    expect(
      classifyChatErrorCode({ message: 'The model gpt-x was not found' }),
    ).toBe('model_not_found');
  });

  it('distinguishes unreachable host from transient provider error', () => {
    expect(classifyChatErrorCode({ code: 'ECONNREFUSED' })).toBe(
      'provider_unreachable',
    );
    expect(classifyChatErrorCode({ code: 'ENOTFOUND' })).toBe(
      'provider_unreachable',
    );
    expect(classifyChatErrorCode({ message: 'fetch failed' })).toBe(
      'provider_unreachable',
    );
    // resets/timeouts/5xx stay transient
    expect(classifyChatErrorCode({ code: 'ECONNRESET' })).toBe(
      'provider_error',
    );
    expect(classifyChatErrorCode({ status: 503 })).toBe('provider_error');
    expect(classifyChatErrorCode({ message: 'Request timed out' })).toBe(
      'provider_error',
    );
  });

  it('classifies rate limits, content filter, context length', () => {
    expect(classifyChatErrorCode({ status: 429 })).toBe('rate_limited');
    expect(classifyChatErrorCode({ message: 'content policy violation' })).toBe(
      'content_filter',
    );
    expect(
      classifyChatErrorCode({ message: 'maximum context length exceeded' }),
    ).toBe('context_length');
  });

  it('classifies OpenRouter output-budget-in-context errors as output_cap_too_high', () => {
    expect(
      classifyChatErrorCode({
        message:
          "This endpoint's maximum context length is 1048576 tokens. However, you requested about 1064907 tokens (3270 of text input, 13061 of tool input, 1048576 in the output).",
      }),
    ).toBe('output_cap_too_high');
  });

  it('prefers operator-config parameter mismatch over token_limit', () => {
    expect(
      classifyChatErrorCode({
        message:
          "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens'",
      }),
    ).toBe('unsupported_parameter');
    expect(
      classifyChatErrorCode({
        message: 'max_tokens is too large: 32768; supports at most 16384',
      }),
    ).toBe('output_cap_too_high');
  });

  it('classifies OpenAI combination rejections as unsupported_parameter', () => {
    // Observed 2026-08-14 on gpt-5.5: tools + any reasoning effort above
    // "none" are refused together on /v1/chat/completions.
    expect(
      classifyChatErrorCode({
        status: 400,
        message:
          "Function tools with reasoning_effort are not supported for gpt-5.5 in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
      }),
    ).toBe('unsupported_parameter');
  });

  it('accepts a raw string and falls back to generic', () => {
    expect(classifyChatErrorCode('429 too many requests')).toBe('rate_limited');
    expect(classifyChatErrorCode('something weird happened')).toBe('generic');
    expect(classifyChatErrorCode(null)).toBe('generic');
  });

  it('treats missing-provider / missing-key as missing_api_key', () => {
    expect(
      classifyChatErrorCode({
        message: 'Uncaught NoProviderAvailableError: no providers',
      }),
    ).toBe('missing_api_key');
    expect(
      classifyChatErrorCode({ message: 'MissingApiKeyError: no key' }),
    ).toBe('missing_api_key');
  });
});

describe('PROVIDER_SCOPED_ERROR_CODES', () => {
  it('contains exactly the deterministic provider-level codes', () => {
    expect([...PROVIDER_SCOPED_ERROR_CODES].sort()).toEqual([
      'auth_error',
      'credit_exhausted',
      'provider_unreachable',
    ]);
  });

  it('does not include transient or model-scoped codes', () => {
    for (const code of ['provider_error', 'rate_limited', 'model_not_found']) {
      expect(PROVIDER_SCOPED_ERROR_CODES.has(code as never)).toBe(false);
    }
  });
});

describe('isChatErrorCode', () => {
  it('accepts every declared code and rejects others', () => {
    for (const code of CHAT_ERROR_CODES) {
      expect(isChatErrorCode(code)).toBe(true);
    }
    expect(isChatErrorCode('nope')).toBe(false);
    expect(isChatErrorCode(42)).toBe(false);
  });
});

describe('i18n key coverage', () => {
  it('maps every code to a base i18n key', () => {
    for (const code of CHAT_ERROR_CODES) {
      expect(CHAT_ERROR_I18N_KEY[code]).toMatch(/^error/);
    }
  });
});

describe('buildHumanErrorSentence', () => {
  it('names the provider for funds/auth/unreachable', () => {
    expect(
      buildHumanErrorSentence('credit_exhausted', { provider: 'OpenRouter' }),
    ).toContain('OpenRouter');
    expect(
      buildHumanErrorSentence('auth_error', { provider: 'OpenRouter' }),
    ).toContain('OpenRouter');
  });

  it('falls back gracefully when no provider is known', () => {
    expect(buildHumanErrorSentence('credit_exhausted')).toContain('credits');
  });
});

describe('encodeChatError / decodeChatError', () => {
  it('round-trips structured fields', () => {
    const encoded = encodeChatError({
      code: 'credit_exhausted',
      provider: 'openrouter',
      model: 'anthropic/claude-opus-4.8',
      triedCount: 3,
      raw: 'HTTP 402: requires more credits',
    });
    const decoded = decodeChatError(encoded);
    expect(decoded.code).toBe('credit_exhausted');
    expect(decoded.provider).toBe('openrouter');
    expect(decoded.model).toBe('anthropic/claude-opus-4.8');
    expect(decoded.triedCount).toBe(3);
    expect(decoded.raw).toBe('HTTP 402: requires more credits');
  });

  it('survives raw messages containing newlines and special chars', () => {
    const raw = 'line one\nline two: {"a":1}\nat /node_modules/x.ts:1:2';
    const decoded = decodeChatError(
      encodeChatError({ code: 'provider_error', raw }),
    );
    expect(decoded.code).toBe('provider_error');
    expect(decoded.raw).toBe(raw);
  });

  it('treats legacy (un-enveloped) errors as raw only', () => {
    const decoded = decodeChatError('plain provider error string');
    expect(decoded.code).toBeUndefined();
    expect(decoded.raw).toBe('plain provider error string');
  });

  it('returns empty object for undefined', () => {
    expect(decodeChatError(undefined)).toEqual({});
  });

  it('ignores an unknown code in the envelope', () => {
    const encoded = `TALE_ERR1 ${encodeURIComponent(
      JSON.stringify({ code: 'bogus', provider: 'x' }),
    )}\nraw`;
    const decoded = decodeChatError(encoded);
    expect(decoded.code).toBeUndefined();
    expect(decoded.provider).toBe('x');
    expect(decoded.raw).toBe('raw');
  });
});

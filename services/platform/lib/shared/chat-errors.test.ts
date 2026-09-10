import { describe, expect, it } from 'vitest';

import {
  CHAT_ERROR_CODES,
  CHAT_ERROR_I18N_KEY,
  classifyChatErrorCode,
  decodeChatError,
  describeChatError,
  encodeChatError,
  isChatErrorCode,
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

  it("classifies Z.ai's account refusals, which arrive as HTTP 429, before rate limits", () => {
    // The generation layer wraps the provider body into the message; the
    // classifier must read the refusal out of that text, not just a code.
    const wrapped =
      'The model provider answered 429: {"error":{"code":"1311","message":"Your current subscription plan does not yet include access to GLM-5V-Turbo"}}';
    expect(classifyChatErrorCode({ status: 429, message: wrapped })).toBe(
      'model_not_entitled',
    );
    expect(classifyChatErrorCode({ status: 429, code: '1311' })).toBe(
      'model_not_entitled',
    );
    expect(
      classifyChatErrorCode({
        message: 'This model is not included in your plan.',
      }),
    ).toBe('model_not_entitled');
    expect(
      classifyChatErrorCode({
        status: 429,
        message:
          '429 Insufficient balance or no resource package. Please recharge.',
      }),
    ).toBe('credit_exhausted');
    expect(classifyChatErrorCode({ status: 429, code: '1113' })).toBe(
      'credit_exhausted',
    );
    // A real rate limit still reads as one.
    expect(
      classifyChatErrorCode({ status: 429, message: 'Too many requests' }),
    ).toBe('rate_limited');
  });

  it('reads the provider code out of the real wire shapes, not only a flat field', () => {
    // The direct wire wraps the provider body into its sentence with the
    // status attached — the code is inside the JSON text, the wording may
    // be anything (a localized message, a rewrite).
    expect(
      classifyChatErrorCode({
        status: 429,
        message:
          'The model provider answered 429: {"error":{"code":"1311","message":"当前套餐不包含该模型"}}',
      }),
    ).toBe('model_not_entitled');
    expect(
      classifyChatErrorCode({
        status: 429,
        message:
          'The model provider answered 429: {"error":{"code":"1113","message":"余额不足"}}',
      }),
    ).toBe('credit_exhausted');
    // An SDK error nests the provider body under `error`.
    expect(
      classifyChatErrorCode({
        status: 429,
        error: { code: '1311', message: 'refused' },
      }),
    ).toBe('model_not_entitled');
    expect(classifyChatErrorCode({ status: 429, error: { code: 1113 } })).toBe(
      'credit_exhausted',
    );
  });

  it('classifies the platform’s own model refusals as model_not_found', () => {
    expect(
      classifyChatErrorCode({
        data: {
          code: 'CHAT_PROVIDER_UNAVAILABLE',
          message:
            'Provider "a" no longer serves model "m" in this organization.',
        },
      }),
    ).toBe('model_not_found');
    expect(
      classifyChatErrorCode({
        data: {
          code: 'CHAT_MODEL_UNKNOWN',
          message: 'No model "m" is available in this organization.',
        },
      }),
    ).toBe('model_not_found');
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

  it('reads a platform refusal by its data code and sentence', () => {
    const appError = (code: string, message: string) =>
      Object.assign(new Error(JSON.stringify({ code, message })), {
        data: { code, message },
      });
    expect(
      classifyChatErrorCode(
        appError('CREDENTIAL_DISABLED', 'Credential "Chat key" is disabled'),
      ),
    ).toBe('auth_error');
    expect(
      classifyChatErrorCode(
        appError('CREDENTIAL_KEY_ROTATED', 'encrypted under a previous key'),
      ),
    ).toBe('auth_error');
    expect(
      classifyChatErrorCode(
        appError('CREDENTIAL_NONE_CONFIGURED', 'No default credential'),
      ),
    ).toBe('missing_api_key');
    expect(
      classifyChatErrorCode(
        appError('CREDENTIAL_ENV_UNSET', 'The env var is empty or unset'),
      ),
    ).toBe('missing_api_key');
    // An unknown code still classifies on the sentence, not the JSON blob.
    expect(
      classifyChatErrorCode(
        appError('SOMETHING_ELSE', 'Rate limit reached on the provider'),
      ),
    ).toBe('rate_limited');
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

describe('describeChatError', () => {
  it('prefers the refusal sentence over the serialized payload', () => {
    const error = Object.assign(new Error('{"code":"X","message":"Plain"}'), {
      data: { code: 'X', message: 'Plain words.' },
    });
    expect(describeChatError(error, 'fallback')).toBe('Plain words.');
    expect(describeChatError(new Error('boom'), 'fallback')).toBe('boom');
    expect(describeChatError('not an error', 'fallback')).toBe('fallback');
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

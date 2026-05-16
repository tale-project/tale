import { describe, expect, it } from 'vitest';

import { sanitizeError } from '../sanitize_secrets';

describe('sanitizeError', () => {
  describe('redacts well-known secret shapes', () => {
    const cases: Array<{
      name: string;
      input: string;
      mustNotContain: string;
    }> = [
      {
        name: 'Bearer token',
        input: 'failed with Authorization: Bearer sk_live_abc123XYZ',
        mustNotContain: 'abc123XYZ',
      },
      {
        name: 'Basic auth',
        input: 'tried Basic dXNlcjpwYXNzd29yZA== and got 401',
        mustNotContain: 'dXNlcjpwYXNzd29yZA',
      },
      {
        name: 'x-api-key header',
        input: 'rejected x-api-key: super-secret-xyz',
        mustNotContain: 'super-secret-xyz',
      },
      {
        name: 'URL-embedded credentials',
        input: 'GET https://alice:p%40ss@example.com/v1/x failed',
        mustNotContain: 'alice:p%40ss',
      },
      {
        name: 'OpenAI sk- key',
        input: 'oops sk-proj-ABCDEFGHIJ1234567890 leaked',
        mustNotContain: 'ABCDEFGHIJ1234567890',
      },
      {
        name: 'AWS access key id',
        input: 'AWS error using AKIAIOSFODNN7EXAMPLE',
        mustNotContain: 'AKIAIOSFODNN7EXAMPLE',
      },
      {
        name: 'Google API key',
        input: 'denied: AIzaSyABCDEF1234567890_ghIjKlMn',
        mustNotContain: 'AIzaSyABCDEF1234567890_ghIjKlMn',
      },
      {
        name: 'Slack token',
        input: 'posting xoxb-12345-67890-abcdefghij failed',
        mustNotContain: 'xoxb-12345-67890-abcdefghij',
      },
      {
        name: 'GitHub PAT',
        input: 'auth ghp_AbCdEfGhIjKlMnOpQrStUvWxYzaaaaa rejected',
        mustNotContain: 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYzaaaaa',
      },
      {
        name: 'JWT',
        input:
          'header= eyJhbGciOi0123456789.eyJzdWIiOi9876543210.SflKxwRJSM_aaaaaa next',
        mustNotContain:
          'eyJhbGciOi0123456789.eyJzdWIiOi9876543210.SflKxwRJSM_aaaaaa',
      },
      {
        name: 'query api_key',
        input: 'GET https://example.com/v1/x?api_key=very-secret-token failed',
        mustNotContain: 'very-secret-token',
      },
      {
        name: 'query token',
        input: 'POST .../endpoint?token=AbCdEfGh1234567890 rejected',
        mustNotContain: 'AbCdEfGh1234567890',
      },
      {
        name: 'query password (newly added)',
        input: 'redirect ...&password=ohnoexposed',
        mustNotContain: 'ohnoexposed',
      },
      {
        name: 'query access_token (newly added)',
        input: 'oauth callback ?access_token=opaque-bearer-value',
        mustNotContain: 'opaque-bearer-value',
      },
      {
        name: 'query refresh_token (newly added)',
        input: 'refresh ?refresh_token=rt_abcdef1234567890',
        mustNotContain: 'rt_abcdef1234567890',
      },
      {
        name: 'query client_secret (newly added)',
        input: 'oauth ?client_secret=cs_abcdef1234567890',
        mustNotContain: 'cs_abcdef1234567890',
      },
    ];

    for (const { name, input, mustNotContain } of cases) {
      it(name, () => {
        const out = sanitizeError(input);
        expect(out).not.toContain(mustNotContain);
        expect(out).toContain('[REDACTED]');
      });
    }
  });

  it('preserves the query-string key when redacting a query secret', () => {
    const out = sanitizeError('GET ...?api_key=abcd1234efgh5678 failed');
    expect(out).toContain('api_key=[REDACTED]');
  });

  it('handles a non-Error input by stringifying it first', () => {
    const out = sanitizeError({ message: 'Bearer leak123456789' });
    // toString of a plain object is `[object Object]` — no leak surface,
    // so output is the stringified placeholder unchanged.
    expect(out).toBe('[object Object]');
  });

  it('applies redaction BEFORE truncation when secret straddles boundary', () => {
    // 195 chars of padding + a 30-char secret tail; default maxLen is 200.
    // Without the redact-first ordering the secret tail would survive in
    // the truncated output.
    const padding = 'x'.repeat(195);
    const input = `${padding} Bearer abcdefghijklmnopqrstuvwxyz123`;
    const out = sanitizeError(input);
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz123');
  });

  it('respects maxLen with truncation marker', () => {
    const long = 'a'.repeat(500);
    const out = sanitizeError(long, 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith('…')).toBe(true);
  });

  it('passes through innocuous strings unchanged', () => {
    const out = sanitizeError('TTS API 502: Bad Gateway');
    expect(out).toBe('TTS API 502: Bad Gateway');
  });
});

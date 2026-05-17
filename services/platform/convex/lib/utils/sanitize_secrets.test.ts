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
      {
        name: 'Authorization with custom ApiKey scheme',
        input: 'failed with Authorization: ApiKey custom-scheme-token-xyz',
        mustNotContain: 'custom-scheme-token-xyz',
      },
      {
        name: 'Authorization with Token scheme',
        input: 'rejected: Authorization: Token abcd1234efgh5678',
        mustNotContain: 'abcd1234efgh5678',
      },
      {
        name: 'GitHub fine-grained PAT',
        input:
          'auth github_pat_11ABCDEFG0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa rejected',
        mustNotContain:
          'github_pat_11ABCDEFG0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      {
        name: 'Convex deploy key',
        input: 'deploy via convex_dev_a1b2c3d4e5f6g7h8i9j0k1l2m3n4 failed',
        mustNotContain: 'convex_dev_a1b2c3d4e5f6g7h8i9j0k1l2m3n4',
      },
      {
        name: 'JSON password field',
        input: 'body: {"username":"alice","password":"hunter2supersecret"}',
        mustNotContain: 'hunter2supersecret',
      },
      {
        name: 'JSON client_secret field',
        input: '{"client_id":"abc","client_secret":"cs_leaky_value_42"}',
        mustNotContain: 'cs_leaky_value_42',
      },
      {
        name: 'JSON access_token field',
        input: '{"access_token":"oauth_bearer_a1b2c3"}',
        mustNotContain: 'oauth_bearer_a1b2c3',
      },
      {
        name: 'Stripe live secret key (sk_live_)',
        input: 'stripe call failed: sk_live_AbCdEfGhIjKlMnOpQrStUv12 expired',
        mustNotContain: 'sk_live_AbCdEfGhIjKlMnOpQrStUv12',
      },
      {
        name: 'Stripe test publishable key (pk_test_)',
        input: 'misconfig pk_test_4eC39HqLyjWDarjtT1zdp7dc',
        mustNotContain: 'pk_test_4eC39HqLyjWDarjtT1zdp7dc',
      },
      {
        name: 'Stripe restricted key (rk_live_)',
        input: 'limited access rk_live_AbCdEfGhIjKlMnOpQrStUv12',
        mustNotContain: 'rk_live_AbCdEfGhIjKlMnOpQrStUv12',
      },
      {
        name: 'OpenAI org identifier',
        input: 'context org-AbCdEfGhIjKlMnOpQrStUvWxYzZZ in request body',
        mustNotContain: 'org-AbCdEfGhIjKlMnOpQrStUvWxYzZZ',
      },
      {
        name: 'OpenAI project identifier',
        input: 'project proj_AbCdEfGhIjKlMnOpQrStUvWxYzZZ rejected',
        mustNotContain: 'proj_AbCdEfGhIjKlMnOpQrStUvWxYzZZ',
      },
      {
        name: 'Cookie header line',
        input:
          'Cookie: session=abc123; other=def456; better-auth.session_token=tok_xyz_aaaaaaaaaaaa',
        mustNotContain: 'tok_xyz_aaaaaaaaaaaa',
      },
      {
        name: 'Set-Cookie header line',
        input:
          'Set-Cookie: better-auth.session_token=tok_xyz_bbbbbbbbbbbb; HttpOnly; Path=/',
        mustNotContain: 'tok_xyz_bbbbbbbbbbbb',
      },
      {
        name: 'Bare better-auth session token (no Cookie prefix)',
        input:
          'sessionString=better-auth.session_token=tok_zzz_cccccccccccc&user=alice',
        mustNotContain: 'tok_zzz_cccccccccccc',
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

  it('preserves the JSON key when redacting a body secret', () => {
    const out = sanitizeError('body {"password":"hunter2supersecret"}');
    expect(out).toContain('"password":');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('hunter2supersecret');
  });

  it('redacts the full token after a custom Authorization scheme', () => {
    // Authorization redaction consumes through end-of-line. Content on
    // subsequent lines must survive so multi-line error bodies stay
    // diagnosable.
    const out = sanitizeError(
      'Authorization: ApiKey supersecret-token-1234\nfollow-up line prose',
    );
    expect(out).not.toContain('supersecret-token-1234');
    expect(out).toContain('follow-up line prose');
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

  it('does not leak the tail of a JSON object when password value contains an escaped quote', () => {
    // Round-5 finding #15: the previous JSON-value class `[^"]*` stopped
    // at the first quote, so a value containing a backslash-escaped quote
    // truncated the redaction early and exposed the rest of the object
    // verbatim. The updated class `(?:[^"\\]|\\.)*` honours escapes.
    const input = '{"password":"hunter2\\"more","other":"safe-public-value"}';
    const out = sanitizeError(input);
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('more');
    expect(out).toContain('"password":');
    expect(out).toContain('[REDACTED]');
    // The tail of the JSON object stays visible — it's not a secret.
    expect(out).toContain('"other"');
  });

  it('is idempotent: sanitize(sanitize(x)) === sanitize(x)', () => {
    const inputs = [
      'Bearer eyJabcd1234.eyJxyz5678.SflKxwRJSM_aaaaa next',
      'GET https://alice:secret@example.com/v1/x failed',
      'config sk_live_AbCdEfGhIjKlMnOpQrStUv12 expired',
      'oauth ?access_token=opaque-bearer-value rejected',
      'body {"password":"hunter2"} from client',
      'Cookie: better-auth.session_token=tok_xyz_aaaaaaaaaaaa',
    ];
    for (const input of inputs) {
      const once = sanitizeError(input);
      const twice = sanitizeError(once);
      expect(twice).toBe(once);
    }
  });

  it('does not catastrophically backtrack on adversarial input', () => {
    // 100k chars of mixed alphanumerics with occasional secret-shaped
    // suffixes. Should complete well under a second; flag if a pattern
    // grows a polynomial worst case.
    const haystack =
      'a'.repeat(50_000) + 'Bearer aaaaaaaaaaaa' + 'b'.repeat(50_000);
    const start = Date.now();
    sanitizeError(haystack, 1_000_000);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

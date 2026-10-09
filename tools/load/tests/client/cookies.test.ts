import { describe, expect, test } from 'bun:test';

import {
  CookieJar,
  sessionCookieName,
  signSessionToken,
} from '../../src/client/cookies.ts';

describe('CookieJar', () => {
  test('parses name=value and ignores attributes it does not need', () => {
    const jar = new CookieJar();
    jar.setFromHeaders([
      'better-auth.session_token=abc.def%3D; Path=/; HttpOnly; SameSite=Lax',
      'theme=dark',
      'broken',
      '=nameless',
    ]);
    expect(jar.get('better-auth.session_token')).toBe('abc.def%3D');
    expect(jar.get('theme')).toBe('dark');
    expect(jar.size).toBe(2);
    expect(jar.header()).toBe(
      'better-auth.session_token=abc.def%3D; theme=dark',
    );
  });

  test('accepts a single header string and replaces existing values', () => {
    const jar = new CookieJar();
    jar.setFromHeaders('a=1');
    jar.setFromHeaders('a=2; Path=/');
    jar.setFromHeaders(undefined);
    expect(jar.header()).toBe('a=2');
  });

  test('honours Max-Age, which wins over Expires', () => {
    const jar = new CookieJar();
    const now = 1_700_000_000_000;
    jar.setFromHeaders(
      [
        'short=1; Max-Age=10; Expires=Wed, 01 Jan 2200 00:00:00 GMT',
        'long=2; Max-Age=3600',
        'session=3',
      ],
      now,
    );
    expect(jar.header(now + 5_000)).toBe('short=1; long=2; session=3');
    expect(jar.get('short', now + 10_000)).toBeUndefined();
    expect(jar.header(now + 10_000)).toBe('long=2; session=3');
    expect(jar.header(now + 3_600_000)).toBe('session=3');
  });

  test('honours Expires', () => {
    const jar = new CookieJar();
    const now = Date.parse('2026-01-01T00:00:00Z');
    jar.setFromHeaders('a=1; Expires=Thu, 01 Jan 2026 00:01:00 GMT', now);
    expect(jar.get('a', now + 59_000)).toBe('1');
    expect(jar.get('a', now + 60_000)).toBeUndefined();
  });

  test('deletion cookies remove what they name', () => {
    const jar = new CookieJar();
    jar.setFromHeaders(['a=1', 'b=2', 'c=3', 'd=4']);
    jar.setFromHeaders([
      'a=; Max-Age=0; Path=/',
      'b=gone; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'c=; Path=/',
    ]);
    expect(jar.header()).toBe('d=4');
    jar.clear();
    expect(jar.header()).toBe('');
    expect(jar.size).toBe(0);
  });
});

describe('sessionCookieName', () => {
  test('adds the __Secure- prefix on https only', () => {
    expect(sessionCookieName('https://tale.example.com')).toBe(
      '__Secure-better-auth.session_token',
    );
    expect(sessionCookieName('http://127.0.0.1:3000')).toBe(
      'better-auth.session_token',
    );
  });
});

/**
 * better-call's signCookieValue, re-derived independently: WebCrypto
 * HMAC-SHA256 under the secret, standard base64, `value.signature`,
 * URI-encoded.
 */
async function referenceSignature(
  value: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  );
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return encodeURIComponent(`${value}.${base64}`);
}

describe('signSessionToken', () => {
  test("matches better-call's signed cookie value", async () => {
    const cases: [string, string][] = [
      ['Qx0n4M8kz2yR7cXb1fJ9wLp3tVh6sD5a', 'better-auth-secret-123456789'],
      ['short', 'ünïcödé secret ✓'],
      ['load_abc1_tokenvalue_with-dash_and_underscore', 'x'],
    ];
    for (const [token, secret] of cases) {
      const signed = signSessionToken(token, secret);
      expect(signed).toBe(await referenceSignature(token, secret));
      const decoded = decodeURIComponent(signed);
      const signature = decoded.slice(decoded.lastIndexOf('.') + 1);
      expect(decoded.slice(0, decoded.lastIndexOf('.'))).toBe(token);
      // better-call's getSignedCookie rejects anything else.
      expect(signature).toHaveLength(44);
      expect(signature.endsWith('=')).toBe(true);
    }
  });
});

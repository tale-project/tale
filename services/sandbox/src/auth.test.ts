// HMAC verify tests — covers the 30s window, replay rejection via the nonce
// cache, and the `reason` discriminator.

import { afterEach, describe, expect, test } from 'bun:test';

import {
  TIMESTAMP_TOLERANCE_MS,
  _resetNonceCacheForTests,
  sign,
  verify,
} from './auth.ts';

const TOKEN = 'test-token';
const METHOD = 'POST';
const PATH = '/v1/execute';
const BODY = JSON.stringify({ hello: 'world' });

afterEach(() => {
  _resetNonceCacheForTests();
});

function buildHeaders(nowMs: number): { signature: string; timestamp: string } {
  const timestamp = String(nowMs);
  const signature = sign(METHOD, PATH, timestamp, BODY, TOKEN);
  return { signature, timestamp };
}

describe('verify — happy path', () => {
  test('accepts a freshly signed request', () => {
    const now = Date.now();
    const { signature, timestamp } = buildHeaders(now);
    const r = verify(METHOD, PATH, BODY, signature, timestamp, TOKEN, now);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  test('window is exactly 30s — accepts at +29.999s', () => {
    const tsMs = Date.now();
    const { signature, timestamp } = buildHeaders(tsMs);
    const r = verify(
      METHOD,
      PATH,
      BODY,
      signature,
      timestamp,
      TOKEN,
      tsMs + TIMESTAMP_TOLERANCE_MS - 1,
    );
    expect(r.ok).toBe(true);
  });
});

describe('verify — replay protection', () => {
  test('second use of the same signature within the window is rejected', () => {
    const now = Date.now();
    const { signature, timestamp } = buildHeaders(now);
    const first = verify(METHOD, PATH, BODY, signature, timestamp, TOKEN, now);
    expect(first.ok).toBe(true);
    const second = verify(
      METHOD,
      PATH,
      BODY,
      signature,
      timestamp,
      TOKEN,
      now + 1_000,
    );
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('replay');
  });

  test('cancel-style empty-body request also dedups by signature', () => {
    const now = Date.now();
    const ts = String(now);
    const sig = sign('POST', '/v1/cancel/abc', ts, '', TOKEN);
    const first = verify('POST', '/v1/cancel/abc', '', sig, ts, TOKEN, now);
    const second = verify(
      'POST',
      '/v1/cancel/abc',
      '',
      sig,
      ts,
      TOKEN,
      now + 500,
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('replay');
  });
});

describe('verify — failure discriminators', () => {
  test('missing signature header', () => {
    const now = Date.now();
    const r = verify(METHOD, PATH, BODY, null, String(now), TOKEN, now);
    expect(r).toEqual({ ok: false, reason: 'missing_signature' });
  });

  test('missing timestamp header', () => {
    const now = Date.now();
    const { signature } = buildHeaders(now);
    const r = verify(METHOD, PATH, BODY, signature, null, TOKEN, now);
    expect(r).toEqual({ ok: false, reason: 'missing_timestamp' });
  });

  test('bad timestamp (non-numeric)', () => {
    const r = verify(METHOD, PATH, BODY, 'whatever', 'nope', TOKEN, Date.now());
    expect(r).toEqual({ ok: false, reason: 'bad_timestamp' });
  });

  test('timestamp_skew past the 30s window', () => {
    const tsMs = Date.now();
    const { signature, timestamp } = buildHeaders(tsMs);
    const r = verify(
      METHOD,
      PATH,
      BODY,
      signature,
      timestamp,
      TOKEN,
      tsMs + TIMESTAMP_TOLERANCE_MS + 1_000,
    );
    expect(r).toEqual({ ok: false, reason: 'timestamp_skew' });
  });

  test('wrong signature → bad_signature, not replay', () => {
    const now = Date.now();
    const { timestamp } = buildHeaders(now);
    // Same length (sha256 hex = 64 chars) to exercise timingSafeEqual.
    const bogus = 'a'.repeat(64);
    const r = verify(METHOD, PATH, BODY, bogus, timestamp, TOKEN, now);
    expect(r).toEqual({ ok: false, reason: 'bad_signature' });
  });

  test('signature with wrong length → bad_signature', () => {
    const now = Date.now();
    const { timestamp } = buildHeaders(now);
    const r = verify(METHOD, PATH, BODY, 'too-short', timestamp, TOKEN, now);
    expect(r).toEqual({ ok: false, reason: 'bad_signature' });
  });

  test('signature bound to method: GET signature does not verify a POST', () => {
    const now = Date.now();
    const ts = String(now);
    const getSig = sign('GET', PATH, ts, BODY, TOKEN);
    const r = verify(METHOD, PATH, BODY, getSig, ts, TOKEN, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad_signature');
  });

  test('signature bound to path: /v1/execute signature does not verify /v1/cancel/abc', () => {
    const now = Date.now();
    const ts = String(now);
    const exSig = sign(METHOD, '/v1/execute', ts, '', TOKEN);
    const r = verify(METHOD, '/v1/cancel/abc', '', exSig, ts, TOKEN, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad_signature');
  });
});

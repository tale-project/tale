// Smoke tests for the HTTP entrypoint's contracts.
//
// `server.ts` runs `loadConfig()` + `void main()` at module load, so we
// don't import it directly. Instead we exercise the wire-level guarantees
// that the router depends on (id alphabet regex, HMAC verifier, fail-closed
// config defaults) — the same way `docker-args.test.ts` covers the spawn
// argv builder without ever booting the server.

import { describe, expect, test } from 'bun:test';

import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  TIMESTAMP_TOLERANCE_MS,
  sign,
  verify,
} from './auth.ts';
import { loadConfig } from './config.ts';
import { ID_ALPHABET_RE } from './wire.ts';

// The cancel-route regex in server.ts is constructed from the same id alphabet
// as wire.ts (centralised in commit e9211127d). This block is a regression
// gate so a future widening on one side doesn't silently desync from the
// router. The literal here mirrors `CANCEL_ROUTE_RE` in server.ts.
const CANCEL_ROUTE_RE = /^\/v1\/cancel\/([a-zA-Z0-9_-]{1,64})$/;

describe('cancel route regex', () => {
  test('accepts a Convex doc-id (base32-ish, includes letters g-z)', () => {
    // Real Convex doc ids look like k7… and freely contain a-z; the original
    // narrower [0-9a-f] alphabet rejected them, which is the bug this regex
    // fixes.
    const id = 'k74m9zr5b8jcgvx2pqfwsdyhntq3l1a0';
    expect(CANCEL_ROUTE_RE.test(`/v1/cancel/${id}`)).toBe(true);
    expect(ID_ALPHABET_RE.test(id)).toBe(true);
  });

  test('accepts dash + underscore (dev id alphabet)', () => {
    expect(CANCEL_ROUTE_RE.test('/v1/cancel/dev_run-001')).toBe(true);
  });

  test('rejects path traversal and shell metacharacters', () => {
    for (const bad of [
      '/v1/cancel/../escape',
      '/v1/cancel/a;b',
      '/v1/cancel/$(whoami)',
      '/v1/cancel/a b',
      '/v1/cancel/',
    ]) {
      expect(CANCEL_ROUTE_RE.test(bad)).toBe(false);
    }
  });

  test('caps id length at 64', () => {
    const tooLong = 'a'.repeat(65);
    expect(CANCEL_ROUTE_RE.test(`/v1/cancel/${tooLong}`)).toBe(false);
  });
});

describe('loadConfig fail-closed defaults', () => {
  test('returns null token + allowUnauth=false on a fresh env', () => {
    // server.ts main() relies on `cfg.sandboxToken === null && !cfg.allowUnauth`
    // to refuse to start. Drop the env vars and re-parse to verify the config
    // surface matches that contract.
    const prevToken = process.env.SANDBOX_TOKEN;
    const prevAllow = process.env.SANDBOX_ALLOW_UNAUTH;
    delete process.env.SANDBOX_TOKEN;
    delete process.env.SANDBOX_ALLOW_UNAUTH;
    try {
      const cfg = loadConfig();
      expect(cfg.sandboxToken).toBeNull();
      expect(cfg.allowUnauth).toBe(false);
    } finally {
      if (prevToken !== undefined) process.env.SANDBOX_TOKEN = prevToken;
      if (prevAllow !== undefined) process.env.SANDBOX_ALLOW_UNAUTH = prevAllow;
    }
  });

  test('treats empty-string SANDBOX_TOKEN as unset', () => {
    const prev = process.env.SANDBOX_TOKEN;
    process.env.SANDBOX_TOKEN = '';
    try {
      const cfg = loadConfig();
      expect(cfg.sandboxToken).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.SANDBOX_TOKEN;
      else process.env.SANDBOX_TOKEN = prev;
    }
  });
});

describe('HMAC verify (method+path+ts+body binding)', () => {
  const token = 'shared-secret';
  const body = JSON.stringify({ executionId: 'abc', code: 'print(1)' });
  const method = 'POST';
  const path = '/v1/execute';
  const now = 1_700_000_000_000;
  const ts = String(now);

  test('accepts a correctly-signed request', () => {
    const sig = sign(method, path, ts, body, token);
    expect(verify(method, path, body, sig, ts, token, now)).toEqual({
      ok: true,
    });
  });

  test('rejects a wrong signature', () => {
    const sig = sign(method, path, ts, body, 'other-secret');
    expect(verify(method, path, body, sig, ts, token, now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('rejects a tampered body', () => {
    const sig = sign(method, path, ts, body, token);
    expect(verify(method, path, `${body} `, sig, ts, token, now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('rejects a captured signature replayed against a different path', () => {
    // The whole point of binding the path: a leaked /v1/execute signature
    // must not authenticate /v1/cancel/<id>.
    const sig = sign(method, '/v1/execute', ts, body, token);
    expect(verify(method, '/v1/cancel/abc', body, sig, ts, token, now)).toEqual(
      { ok: false, reason: 'bad_signature' },
    );
  });

  test('rejects a captured signature replayed with a different method', () => {
    const sig = sign('POST', path, ts, body, token);
    expect(verify('GET', path, body, sig, ts, token, now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('rejects a missing signature header', () => {
    expect(verify(method, path, body, null, ts, token, now)).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });

  test('rejects a missing timestamp header', () => {
    const sig = sign(method, path, ts, body, token);
    expect(verify(method, path, body, sig, null, token, now)).toEqual({
      ok: false,
      reason: 'missing_timestamp',
    });
  });

  test('rejects timestamps outside the tolerance window', () => {
    const sig = sign(method, path, ts, body, token);
    const tooLate = now + TIMESTAMP_TOLERANCE_MS + 1;
    expect(verify(method, path, body, sig, ts, token, tooLate)).toEqual({
      ok: false,
      reason: 'timestamp_skew',
    });
    const tooEarly = now - TIMESTAMP_TOLERANCE_MS - 1;
    expect(verify(method, path, body, sig, ts, token, tooEarly)).toEqual({
      ok: false,
      reason: 'timestamp_skew',
    });
  });

  test('rejects a non-numeric timestamp', () => {
    const sig = sign(method, path, ts, body, token);
    expect(verify(method, path, body, sig, 'not-a-number', token, now)).toEqual(
      { ok: false, reason: 'bad_timestamp' },
    );
  });

  test('rejects a signature of the wrong length (timing-safe length check)', () => {
    const sig = sign(method, path, ts, body, token);
    expect(
      verify(method, path, body, sig.slice(0, -1), ts, token, now),
    ).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verify(method, path, body, `${sig}aa`, ts, token, now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('exports stable header names (wire contract)', () => {
    expect(SIGNATURE_HEADER).toBe('x-tale-sandbox-signature');
    expect(TIMESTAMP_HEADER).toBe('x-tale-sandbox-timestamp');
  });
});

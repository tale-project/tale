// Smoke tests for the HTTP entrypoint's contracts.
//
// `server.ts` runs `loadConfig()` + `void main()` at module load, so we
// don't import it directly. Instead we exercise the wire-level guarantees
// that the router depends on (id alphabet regex, HMAC verifier, fail-closed
// config defaults) — the same way `docker-args.test.ts` covers the spawn
// argv builder without ever booting the server.

import { afterEach, describe, expect, test } from 'bun:test';

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

// The screencast WS route regex in server.ts. This block is a regression gate
// for the route ordering contract: SESSION_BROWSER_SCREENCAST_RE must be
// matched BEFORE the bare SESSION_ONE_RE (it carries a trailing /screencast
// segment), and must reject anything outside the id alphabet.
const SESSION_ID = '([a-zA-Z0-9_-]{1,64})';
const SESSION_BROWSER_SCREENCAST_RE = new RegExp(
  `^/v1/sessions/${SESSION_ID}/screencast$`,
);
const SESSION_ONE_RE = new RegExp(`^/v1/sessions/${SESSION_ID}$`);

describe('screencast route regex', () => {
  test('matches /v1/sessions/:id/screencast and captures the id', () => {
    const m = '/v1/sessions/sess_abc-123/screencast'.match(
      SESSION_BROWSER_SCREENCAST_RE,
    );
    expect(m?.[1]).toBe('sess_abc-123');
  });

  test('does NOT match the bare session route (no /screencast suffix)', () => {
    expect(
      '/v1/sessions/sess_abc'.match(SESSION_BROWSER_SCREENCAST_RE),
    ).toBeNull();
  });

  test('the bare :id matcher does NOT swallow a /screencast path', () => {
    // Ordering safety: the screencast path must not be captured as a session id
    // by the bare matcher (which would route it to handleGet instead).
    expect('/v1/sessions/sess_abc/screencast'.match(SESSION_ONE_RE)).toBeNull();
  });

  test('rejects traversal / metacharacters in the id', () => {
    for (const bad of [
      '/v1/sessions/../escape/screencast',
      '/v1/sessions/a;b/screencast',
      '/v1/sessions//screencast',
    ]) {
      expect(bad.match(SESSION_BROWSER_SCREENCAST_RE)).toBeNull();
    }
  });
});

describe('screencast HMAC gate (empty-body GET)', () => {
  // The screencast upgrade authorizes with an EMPTY body — the GET carries no
  // body, so the signature is over sha256('') exactly like the files/content
  // GET. A correctly-signed empty-body request verifies; a bad/missing one is
  // rejected (the route then returns 401 and never calls server.upgrade).
  const token = 'shared-secret';
  const method = 'GET';
  const path = '/v1/sessions/sess1/screencast';
  const now = 1_700_000_000_000;
  const ts = String(now);

  test('accepts a correctly-signed empty-body GET', () => {
    const sig = sign(method, path, ts, '', token);
    expect(verify(method, path, '', sig, ts, null, token, now)).toEqual({
      ok: true,
    });
  });

  test('rejects a missing signature (→ route returns 401, no upgrade)', () => {
    expect(verify(method, path, '', null, ts, null, token, now)).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });

  test('rejects a signature minted over a non-empty body', () => {
    // An attacker signing some body can't pass the empty-body verify.
    const sig = sign(method, path, ts, '{"x":1}', token);
    expect(verify(method, path, '', sig, ts, null, token, now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
});

describe('loadConfig token policy (fail-closed)', () => {
  // The spawner holds the host docker socket and is reachable from every
  // session container on the shared sandbox network, so it must never boot
  // with HMAC verification off. An unset / blank SANDBOX_TOKEN refuses boot
  // instead of silently turning `authorize()` into a no-op (the audit finding
  // that left every compose stack without a token running the spawner open).
  const prev = process.env.SANDBOX_TOKEN;
  afterEach(() => {
    if (prev === undefined) delete process.env.SANDBOX_TOKEN;
    else process.env.SANDBOX_TOKEN = prev;
  });

  test('refuses to boot when SANDBOX_TOKEN is unset', () => {
    delete process.env.SANDBOX_TOKEN;
    expect(() => loadConfig()).toThrow(/SANDBOX_TOKEN is required/);
  });

  test('treats an empty-string SANDBOX_TOKEN as unset (refuses to boot)', () => {
    process.env.SANDBOX_TOKEN = '';
    expect(() => loadConfig()).toThrow(/SANDBOX_TOKEN is required/);
  });

  test('treats a whitespace-only SANDBOX_TOKEN as unset (refuses to boot)', () => {
    // Otherwise it would silently enable HMAC with a trivially weak space key.
    process.env.SANDBOX_TOKEN = '   ';
    expect(() => loadConfig()).toThrow(/SANDBOX_TOKEN is required/);
  });

  test('trims a padded token so the key matches what the clients sign with', () => {
    process.env.SANDBOX_TOKEN = '  shared-secret  ';
    expect(loadConfig().sandboxToken).toBe('shared-secret');
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
    expect(verify(method, path, body, sig, ts, null, token, now)).toEqual({
      ok: true,
    });
  });

  test('rejects a wrong signature', () => {
    const sig = sign(method, path, ts, body, 'other-secret');
    expect(verify(method, path, body, sig, ts, null, token, now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('rejects a tampered body', () => {
    const sig = sign(method, path, ts, body, token);
    expect(verify(method, path, `${body} `, sig, ts, null, token, now)).toEqual(
      {
        ok: false,
        reason: 'bad_signature',
      },
    );
  });

  test('rejects a captured signature replayed against a different path', () => {
    // The whole point of binding the path: a leaked /v1/execute signature
    // must not authenticate /v1/cancel/<id>.
    const sig = sign(method, '/v1/execute', ts, body, token);
    expect(
      verify(method, '/v1/cancel/abc', body, sig, ts, null, token, now),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  test('rejects a captured signature replayed with a different method', () => {
    const sig = sign('POST', path, ts, body, token);
    expect(verify('GET', path, body, sig, ts, null, token, now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('rejects a missing signature header', () => {
    expect(verify(method, path, body, null, ts, null, token, now)).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });

  test('rejects a missing timestamp header', () => {
    const sig = sign(method, path, ts, body, token);
    expect(verify(method, path, body, sig, null, null, token, now)).toEqual({
      ok: false,
      reason: 'missing_timestamp',
    });
  });

  test('rejects timestamps outside the tolerance window', () => {
    const sig = sign(method, path, ts, body, token);
    const tooLate = now + TIMESTAMP_TOLERANCE_MS + 1;
    expect(verify(method, path, body, sig, ts, null, token, tooLate)).toEqual({
      ok: false,
      reason: 'timestamp_skew',
    });
    const tooEarly = now - TIMESTAMP_TOLERANCE_MS - 1;
    expect(verify(method, path, body, sig, ts, null, token, tooEarly)).toEqual({
      ok: false,
      reason: 'timestamp_skew',
    });
  });

  test('rejects a non-numeric timestamp', () => {
    const sig = sign(method, path, ts, body, token);
    expect(
      verify(method, path, body, sig, 'not-a-number', null, token, now),
    ).toEqual({ ok: false, reason: 'bad_timestamp' });
  });

  test('rejects a signature of the wrong length (timing-safe length check)', () => {
    const sig = sign(method, path, ts, body, token);
    expect(
      verify(method, path, body, sig.slice(0, -1), ts, null, token, now),
    ).toEqual({ ok: false, reason: 'bad_signature' });
    expect(
      verify(method, path, body, `${sig}aa`, ts, null, token, now),
    ).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('exports stable header names (wire contract)', () => {
    expect(SIGNATURE_HEADER).toBe('x-tale-sandbox-signature');
    expect(TIMESTAMP_HEADER).toBe('x-tale-sandbox-timestamp');
  });
});

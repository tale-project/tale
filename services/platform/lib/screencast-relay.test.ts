import { afterEach, beforeEach, describe, expect, test } from 'vitest';

// The spawner's authoritative signer — the platform side must produce a
// byte-identical HMAC or the screencast upgrade 401s. Imported across the
// package boundary so a drift in EITHER side fails this test.
import { sign as spawnerSign } from '../../sandbox/src/auth';
import {
  buildScreencastAuthHeaders,
  resolveSandboxToken,
  signScreencastRequest,
  spawnerScreencastPath,
  spawnerScreencastUrl,
} from './screencast-relay';

describe('signScreencastRequest — parity with the spawner', () => {
  test('matches the spawner sign() for a known empty-body GET', () => {
    const token = 'shared-secret';
    const path = '/v1/sessions/sess1/screencast';
    const ts = '1700000000000';
    const nonce = 'fixed-nonce';
    const ours = signScreencastRequest('GET', path, ts, nonce, '', token);
    // The spawner threads the nonce as the last arg of sign().
    const theirs = spawnerSign('GET', path, ts, '', token, nonce);
    expect(ours).toBe(theirs);
    // Pin the exact digest so a refactor on either side that still agrees with
    // itself but changes the wire format is caught.
    expect(ours).toBe(
      '993534d91e4f8ad6f7ef8af3890014662dbdd47519f8590bd32c335d62ee1ad5',
    );
  });

  test('uppercases the method (parity with the spawner buildSignedString)', () => {
    const token = 't';
    const path = '/v1/sessions/s/screencast';
    const ts = '1';
    const nonce = 'n';
    expect(signScreencastRequest('get', path, ts, nonce, '', token)).toBe(
      spawnerSign('GET', path, ts, '', token, nonce),
    );
  });
});

describe('buildScreencastAuthHeaders', () => {
  test('emits signature + timestamp + nonce headers when a token is present', () => {
    const path = spawnerScreencastPath('sess1');
    const headers = buildScreencastAuthHeaders(path, 'shared-secret');
    expect(headers['x-tale-sandbox-signature']).toBeDefined();
    expect(headers['x-tale-sandbox-timestamp']).toBeDefined();
    expect(headers['x-tale-sandbox-nonce']).toBeDefined();
    // The emitted signature must verify against the spawner signer for the
    // exact timestamp + nonce it chose.
    const ts = headers['x-tale-sandbox-timestamp'];
    const nonce = headers['x-tale-sandbox-nonce'];
    expect(headers['x-tale-sandbox-signature']).toBe(
      spawnerSign('GET', path, ts, '', 'shared-secret', nonce),
    );
  });

  test('returns no headers when the token is null (dev opt-in mode)', () => {
    expect(
      buildScreencastAuthHeaders(spawnerScreencastPath('s'), null),
    ).toEqual({});
  });
});

describe('spawnerScreencastUrl / spawnerScreencastPath', () => {
  const prev = process.env.SANDBOX_URL;
  afterEach(() => {
    if (prev === undefined) delete process.env.SANDBOX_URL;
    else process.env.SANDBOX_URL = prev;
  });

  test('rewrites http SANDBOX_URL to a ws:// screencast URL', () => {
    process.env.SANDBOX_URL = 'http://sandbox:8003';
    expect(spawnerScreencastUrl('sess1')).toBe(
      'ws://sandbox:8003/v1/sessions/sess1/screencast',
    );
  });

  test('rewrites https SANDBOX_URL to wss://', () => {
    process.env.SANDBOX_URL = 'https://sandbox.example.com';
    expect(spawnerScreencastUrl('sess1')).toBe(
      'wss://sandbox.example.com/v1/sessions/sess1/screencast',
    );
  });

  test('percent-encodes the sessionId in both url and signed path', () => {
    process.env.SANDBOX_URL = 'http://sandbox:8003';
    const id = 'org/user weird';
    expect(spawnerScreencastUrl(id)).toBe(
      `ws://sandbox:8003/v1/sessions/${encodeURIComponent(id)}/screencast`,
    );
    expect(spawnerScreencastPath(id)).toBe(
      `/v1/sessions/${encodeURIComponent(id)}/screencast`,
    );
  });

  test('the signed path matches the url pathname (spawner verifies pathname+search)', () => {
    process.env.SANDBOX_URL = 'http://sandbox:8003';
    const url = new URL(spawnerScreencastUrl('sess1'));
    expect(url.pathname).toBe(spawnerScreencastPath('sess1'));
    // No query → signing the bare path equals signing pathname+search.
    expect(url.search).toBe('');
  });
});

describe('resolveSandboxToken', () => {
  const prev = process.env.SANDBOX_TOKEN;
  beforeEach(() => {
    delete process.env.SANDBOX_TOKEN;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.SANDBOX_TOKEN;
    else process.env.SANDBOX_TOKEN = prev;
  });

  test('returns null when unset', () => {
    expect(resolveSandboxToken()).toBeNull();
  });

  test('treats a whitespace-only token as unset (parity with the spawner trim)', () => {
    process.env.SANDBOX_TOKEN = '   ';
    expect(resolveSandboxToken()).toBeNull();
  });

  test('returns a trimmed non-empty token', () => {
    process.env.SANDBOX_TOKEN = '  abc  ';
    expect(resolveSandboxToken()).toBe('abc');
  });
});

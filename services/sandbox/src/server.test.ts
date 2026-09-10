// Smoke tests for the HTTP entrypoint's contracts.
//
// Importing the router does not start a listener or contact Docker/Kubernetes.
// Exercise the actual route dispatch plus HMAC and fail-closed configuration.

import { afterEach, beforeAll, describe, expect, test } from 'bun:test';

import {
  NONCE_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  TIMESTAMP_TOLERANCE_MS,
  sign,
  verify,
} from './auth.ts';
import { loadConfig } from './config.ts';

describe('session HTTP routes', () => {
  let router: typeof import('./server.ts').router;

  beforeAll(async () => {
    const previous = process.env.SANDBOX_TOKEN;
    process.env.SANDBOX_TOKEN = 'route-test-secret';
    try {
      ({ router } = await import('./server.ts'));
    } finally {
      if (previous === undefined) delete process.env.SANDBOX_TOKEN;
      else process.env.SANDBOX_TOKEN = previous;
    }
  });

  test('retired viewer and one-shot routes return 404', async () => {
    for (const [method, path] of [
      ['GET', '/v1/sessions/sess1/screencast'],
      ['POST', '/v1/sessions/sess1/browser/restart'],
      ['POST', '/v1/sessions/sess1/browser/reset'],
      ['POST', '/v1/sessions/sess1/browser/close-pages'],
      ['POST', '/v1/execute'],
      ['POST', '/v1/cancel/exec1'],
    ]) {
      const response = await router(
        new Request(`http://sandbox${path}`, { method }),
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found' });
    }
  });

  test('the session exec route remains authenticated', async () => {
    const response = await router(
      new Request('http://sandbox/v1/sessions/sess1/exec', {
        method: 'POST',
        body: JSON.stringify({ execId: 'exec1', command: ['true'] }),
      }),
    );
    expect(response.status).toBe(401);
  });

  test('capacity requires authentication and binds the organization query', async () => {
    const path = '/v1/capacity?organizationId=org-a';
    expect((await router(new Request(`http://sandbox${path}`))).status).toBe(
      401,
    );
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const response = await router(
      new Request('http://sandbox/v1/capacity?organizationId=org-b', {
        headers: {
          [SIGNATURE_HEADER]: sign(
            'GET',
            path,
            timestamp,
            '',
            'route-test-secret',
            nonce,
          ),
          [TIMESTAMP_HEADER]: timestamp,
          [NONCE_HEADER]: nonce,
        },
      }),
    );
    expect(response.status).toBe(401);
  });

  test('capacity rejects missing or invalid organization ids before observing the host', async () => {
    for (const path of [
      '/v1/capacity',
      '/v1/capacity?organizationId=bad%2Forg',
    ]) {
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const response = await router(
        new Request(`http://sandbox${path}`, {
          headers: {
            [SIGNATURE_HEADER]: sign(
              'GET',
              path,
              timestamp,
              '',
              'route-test-secret',
              nonce,
            ),
            [TIMESTAMP_HEADER]: timestamp,
            [NONCE_HEADER]: nonce,
          },
        }),
      );
      expect(response.status).toBe(400);
    }
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
  const body = JSON.stringify({ execId: 'abc', command: ['true'] });
  const method = 'POST';
  const path = '/v1/sessions/sess1/exec';
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
    // The whole point of binding the path: a leaked session exec signature
    // must not authenticate another session or operation.
    const sig = sign(method, '/v1/sessions/sess1/exec', ts, body, token);
    expect(
      verify(
        method,
        '/v1/sessions/other/exec',
        body,
        sig,
        ts,
        null,
        token,
        now,
      ),
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

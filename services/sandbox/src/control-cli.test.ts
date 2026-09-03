// The in-container control client the deploy runs (`bun src/control-cli.ts
// drain|drain-status`). It signs with the container's own SANDBOX_TOKEN, so the
// HMAC gate on the control routes stays the ONLY door — no unauthenticated
// side-channel for `docker exec`. The loop below is the real one: client signs
// → a live Bun.serve running the real ControlRoutes + request auth verifies.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { _resetNonceCacheForTests, verify } from './auth.ts';
import {
  CONTROL_COMMANDS,
  isControlCommand,
  runControlCommand,
  signedControlHeaders,
} from './control-cli.ts';
import { ControlRoutes } from './control-routes.ts';
import { jsonResponse } from './http-util.ts';
import { createRequestAuth } from './request-auth.ts';

const TOKEN = 'deploy-shared-secret';

describe('signedControlHeaders', () => {
  test('signs the drain POST over an empty body so the spawner verifies it', () => {
    const now = 1_700_000_000_000;
    const headers = signedControlHeaders('drain', TOKEN, now, 'nonce-1');
    const { method, path } = CONTROL_COMMANDS.drain;
    expect(method).toBe('POST');
    expect(path).toBe('/v1/drain');
    expect(
      verify(
        method,
        path,
        '',
        headers['x-tale-sandbox-signature'] ?? null,
        headers['x-tale-sandbox-timestamp'] ?? null,
        headers['x-tale-sandbox-nonce'] ?? null,
        TOKEN,
        now,
      ),
    ).toEqual({ ok: true });
    expect(headers['x-tale-sandbox-timestamp']).toBe(String(now));
    expect(headers['x-tale-sandbox-nonce']).toBe('nonce-1');
  });

  test('signs the drain-status GET against its own path (no cross-route reuse)', () => {
    const now = 1_700_000_000_000;
    const headers = signedControlHeaders('drain-status', TOKEN, now, 'nonce-2');
    expect(
      verify(
        'GET',
        '/v1/drain-status',
        '',
        headers['x-tale-sandbox-signature'] ?? null,
        headers['x-tale-sandbox-timestamp'] ?? null,
        headers['x-tale-sandbox-nonce'] ?? null,
        TOKEN,
        now,
      ),
    ).toEqual({ ok: true });
    // The same signature must NOT verify against the drain POST.
    expect(
      verify(
        'POST',
        '/v1/drain',
        '',
        headers['x-tale-sandbox-signature'] ?? null,
        headers['x-tale-sandbox-timestamp'] ?? null,
        headers['x-tale-sandbox-nonce'] ?? null,
        TOKEN,
        now,
      ),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  test('mints a fresh random nonce per call by default', () => {
    const a = signedControlHeaders('drain', TOKEN);
    const b = signedControlHeaders('drain', TOKEN);
    expect(a['x-tale-sandbox-nonce']).not.toBe(b['x-tale-sandbox-nonce']);
  });
});

describe('isControlCommand', () => {
  test('accepts only the two deploy commands', () => {
    expect(isControlCommand('drain')).toBe(true);
    expect(isControlCommand('drain-status')).toBe(true);
    expect(isControlCommand('sessions')).toBe(false);
    expect(isControlCommand('')).toBe(false);
    expect(isControlCommand('__proto__')).toBe(false);
  });
});

describe('runControlCommand against the real control routes', () => {
  let server: ReturnType<typeof Bun.serve>;
  let control: ControlRoutes;
  let baseUrl: string;

  beforeAll(() => {
    const auth = createRequestAuth(TOKEN, 1024);
    control = new ControlRoutes(auth, () => ({
      sessionCount: () => 1,
      sessionIds: () => ['ses-live'],
    }));
    server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const res = await control.handle(req, new URL(req.url));
        return res ?? jsonResponse({ error: 'not_found' }, 404);
      },
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    void server.stop(true);
  });

  beforeEach(() => {
    _resetNonceCacheForTests();
  });

  test('a client holding the shared token drains and reads status', async () => {
    const drain = await runControlCommand('drain', { token: TOKEN, baseUrl });
    expect(drain.status).toBe(200);
    expect(JSON.parse(drain.body)).toEqual({ draining: true });

    const status = await runControlCommand('drain-status', {
      token: TOKEN,
      baseUrl,
    });
    expect(status.status).toBe(200);
    expect(JSON.parse(status.body)).toEqual({
      draining: true,
      sessions: 1,
      sessionIds: ['ses-live'],
    });
  });

  test('a client with the wrong token is refused (401)', async () => {
    const res = await runControlCommand('drain-status', {
      token: 'tenant-guess',
      baseUrl,
    });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'unauthorized' });
  });
});

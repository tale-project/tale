// The deploy control routes (`POST /v1/drain`, `GET /v1/drain-status`) are
// HMAC-gated exactly like the session routes. Regression gate for the audit
// finding that shipped them open: the spawner's listener sits on the shared
// sandbox network, so an unauthenticated drain let any tenant's sandboxed code
// freeze session creation deployment-wide (and list every live session id).

import { beforeEach, describe, expect, test } from 'bun:test';

import {
  _resetNonceCacheForTests,
  NONCE_HEADER,
  SIGNATURE_HEADER,
  sign,
  TIMESTAMP_HEADER,
} from './auth.ts';
import { ControlRoutes } from './control-routes.ts';
import { createRequestAuth } from './request-auth.ts';

const TOKEN = 'shared-secret';
const BASE = 'http://sandbox:8003';

let nonceCounter = 0;

/** A request signed the way the in-container control client signs it. */
function signedRequest(
  method: 'POST' | 'GET',
  path: string,
  token = TOKEN,
): Request {
  const ts = String(Date.now());
  const nonce = `nonce-${nonceCounter++}`;
  return new Request(`${BASE}${path}`, {
    method,
    headers: {
      [SIGNATURE_HEADER]: sign(method, path, ts, '', token, nonce),
      [TIMESTAMP_HEADER]: ts,
      [NONCE_HEADER]: nonce,
    },
  });
}

function makeControl(sessionIds: string[] = []) {
  const auth = createRequestAuth(TOKEN, 1024);
  return new ControlRoutes(auth, () => ({
    sessionCount: () => sessionIds.length,
    sessionIds: () => sessionIds,
  }));
}

async function dispatch(
  control: ControlRoutes,
  req: Request,
): Promise<Response | null> {
  return control.handle(req, new URL(req.url));
}

beforeEach(() => {
  _resetNonceCacheForTests();
});

describe('control routes — HMAC gate', () => {
  test('rejects an unsigned POST /v1/drain with 401 and does NOT enter drain mode', async () => {
    const control = makeControl();
    const res = await dispatch(
      control,
      new Request(`${BASE}/v1/drain`, { method: 'POST' }),
    );
    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: 'unauthorized' });
    expect(control.isDraining).toBe(false);
  });

  test('rejects an unsigned GET /v1/drain-status with 401 (no session-id leak)', async () => {
    const control = makeControl(['ses-a', 'ses-b']);
    const res = await dispatch(
      control,
      new Request(`${BASE}/v1/drain-status`, { method: 'GET' }),
    );
    expect(res?.status).toBe(401);
    const body = await res?.text();
    expect(body).not.toContain('ses-a');
  });

  test('rejects a drain signed with the wrong token', async () => {
    const control = makeControl();
    const res = await dispatch(
      control,
      signedRequest('POST', '/v1/drain', 'not-the-shared-secret'),
    );
    expect(res?.status).toBe(401);
    expect(control.isDraining).toBe(false);
  });

  test('rejects a signature minted for a different control path', async () => {
    // A captured drain-status signature must not authenticate a drain.
    const control = makeControl();
    const ts = String(Date.now());
    const nonce = 'cross-path';
    const res = await dispatch(
      control,
      new Request(`${BASE}/v1/drain`, {
        method: 'POST',
        headers: {
          [SIGNATURE_HEADER]: sign(
            'GET',
            '/v1/drain-status',
            ts,
            '',
            TOKEN,
            nonce,
          ),
          [TIMESTAMP_HEADER]: ts,
          [NONCE_HEADER]: nonce,
        },
      }),
    );
    expect(res?.status).toBe(401);
    expect(control.isDraining).toBe(false);
  });

  test('accepts a correctly-signed drain, then reports it on a signed status', async () => {
    const control = makeControl(['ses-a', 'ses-b']);
    const drain = await dispatch(control, signedRequest('POST', '/v1/drain'));
    expect(drain?.status).toBe(200);
    expect(await drain?.json()).toEqual({ draining: true });
    expect(control.isDraining).toBe(true);

    const status = await dispatch(
      control,
      signedRequest('GET', '/v1/drain-status'),
    );
    expect(status?.status).toBe(200);
    expect(await status?.json()).toEqual({
      draining: true,
      sessions: 2,
      sessionIds: ['ses-a', 'ses-b'],
    });
  });

  test('a signed status before any drain reads draining:false with zero sessions when the subsystem is not constructed', async () => {
    const auth = createRequestAuth(TOKEN, 1024);
    // A status probe must never force-construct the session subsystem: the
    // peek returns null and the route reports zero without touching it.
    const control = new ControlRoutes(auth, () => null);
    const res = await dispatch(
      control,
      signedRequest('GET', '/v1/drain-status'),
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({
      draining: false,
      sessions: 0,
      sessionIds: [],
    });
  });

  test('drain is idempotent (second signed drain keeps the original anchor)', async () => {
    const control = makeControl();
    await dispatch(control, signedRequest('POST', '/v1/drain'));
    const first = control.drainStartedAt;
    await dispatch(control, signedRequest('POST', '/v1/drain'));
    expect(control.drainStartedAt).toBe(first);
  });

  test('ignores every other path/method so the router falls through', async () => {
    const control = makeControl();
    expect(
      await dispatch(
        control,
        new Request(`${BASE}/v1/drain`, { method: 'GET' }),
      ),
    ).toBeNull();
    expect(
      await dispatch(
        control,
        new Request(`${BASE}/v1/drain-status`, { method: 'POST' }),
      ),
    ).toBeNull();
    expect(
      await dispatch(control, new Request(`${BASE}/health`, { method: 'GET' })),
    ).toBeNull();
    expect(
      await dispatch(
        control,
        new Request(`${BASE}/v1/sessions`, { method: 'POST' }),
      ),
    ).toBeNull();
  });
});

describe('control routes — max-linger self-reap', () => {
  test('never fires while not draining', () => {
    const control = makeControl();
    expect(control.takeLingerReap(1_000, Date.now() + 10_000_000)).toBe(false);
  });

  test('fires exactly once, only after maxLingerMs has elapsed since the drain', async () => {
    const control = makeControl();
    await dispatch(control, signedRequest('POST', '/v1/drain'));
    const startedAt = control.drainStartedAt ?? 0;
    expect(control.takeLingerReap(60_000, startedAt + 59_999)).toBe(false);
    expect(control.takeLingerReap(60_000, startedAt + 60_001)).toBe(true);
    // One-shot: the reap must not re-fire on the next sweep tick.
    expect(control.takeLingerReap(60_000, startedAt + 120_000)).toBe(false);
  });
});

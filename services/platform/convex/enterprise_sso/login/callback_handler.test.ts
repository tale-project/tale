import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../lib/ctx';
import { signValue } from '../sign_cookie_value';
import { ssoCallbackHandler } from './callback_handler';
import type { FinishLogin } from './finish_login';

/**
 * Regressions for A2.1 error handling:
 *
 * 1. Behind the reverse proxy the request origin is the INTERNAL Convex
 *    address (e.g. http://127.0.0.1:3211) — a browser cannot reach it. Error
 *    redirects must target the public SITE_URL (or, once the signed state is
 *    parsed, the state's own origin), never the request origin.
 * 2. Token-exchange failures throw with Microsoft's response body in the
 *    message; the AADSTS code inside it must map to the same readable
 *    login-page error the authorize-stage `?error=` path gets, not collapse
 *    into the generic `sso.errors.serverError`.
 */

const INTERNAL_ORIGIN = 'http://127.0.0.1:3211';
const PUBLIC_ORIGIN = 'https://app.example.com';
const SECRET = 'test-secret';

async function signedState(payload: Record<string, unknown>): Promise<string> {
  const base64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return signValue(base64, SECRET);
}

function callbackRequest(params: Record<string, string>): Request {
  const url = new URL(`${INTERNAL_ORIGIN}/api/sso/callback`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString());
}

/** These cases refuse BEFORE a session is minted; reaching the
 *  finish-login step would itself be the bug. */
const neverFinishes: FinishLogin = () => {
  throw new Error('finishLogin must not be reached on a refusal path');
};

describe('ssoCallbackHandler — error redirects land on the public origin', () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = SECRET;
    process.env.SITE_URL = PUBLIC_ORIGIN;
    delete process.env.BASE_PATH;
  });

  afterEach(() => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.SITE_URL;
    vi.clearAllMocks();
  });

  it('redirects a pre-state failure to SITE_URL, not the internal request origin', async () => {
    const ctx = {
      runQuery: vi.fn(),
      runAction: vi.fn(),
    } as unknown as ActionCtx;

    const res = await ssoCallbackHandler(ctx, callbackRequest({}), {
      finishLogin: neverFinishes,
    });

    expect(res.status).toBe(302);
    const target = new URL(res.headers.get('Location') as string);
    expect(target.origin).toBe(PUBLIC_ORIGIN);
    expect(target.pathname).toBe('/log-in');
  });

  it('maps an AADSTS code thrown from the token exchange to its readable error', async () => {
    const state = await signedState({
      redirectUri: `${PUBLIC_ORIGIN}/http_api/api/sso/callback`,
      timestamp: Date.now(),
      organizationId: 'org1',
    });
    // Reject the first ctx call inside the try with the shape the Entra
    // adapter throws for a bad client secret (entra_id/adapter.ts).
    const ctx = {
      runQuery: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'Token exchange failed: {"error":"invalid_client","error_description":"AADSTS7000215: Invalid client secret provided."}',
          ),
        ),
      runAction: vi.fn(),
    } as unknown as ActionCtx;

    const res = await ssoCallbackHandler(
      ctx,
      callbackRequest({ code: 'code', state }),
      { finishLogin: neverFinishes },
    );

    expect(res.status).toBe(302);
    const target = new URL(res.headers.get('Location') as string);
    expect(target.origin).toBe(PUBLIC_ORIGIN);
    expect(target.searchParams.get('error')).toBe(
      'sso.errors.invalidClientSecret',
    );
    expect(target.searchParams.get('error_code')).toBe('AADSTS7000215');
    expect(target.searchParams.get('recovery')).toBe(
      'sso.errors.recovery.contactAdmin',
    );
  });

  it('keeps the generic error for a throw without an AADSTS code', async () => {
    const state = await signedState({
      redirectUri: `${PUBLIC_ORIGIN}/http_api/api/sso/callback`,
      timestamp: Date.now(),
      organizationId: 'org1',
    });
    const ctx = {
      runQuery: vi.fn().mockRejectedValue(new Error('boom')),
      runAction: vi.fn(),
    } as unknown as ActionCtx;

    const res = await ssoCallbackHandler(
      ctx,
      callbackRequest({ code: 'code', state }),
      { finishLogin: neverFinishes },
    );

    expect(res.status).toBe(302);
    const target = new URL(res.headers.get('Location') as string);
    expect(target.origin).toBe(PUBLIC_ORIGIN);
    expect(target.searchParams.get('error')).toBe('sso.errors.serverError');
  });

  it("prefers the state's own origin over SITE_URL once the state is parsed", async () => {
    process.env.SITE_URL = 'https://other.example.com';
    const state = await signedState({
      redirectUri: `${PUBLIC_ORIGIN}/http_api/api/sso/callback`,
      timestamp: Date.now(),
      organizationId: 'org1',
    });
    // resolveSignInConfig returns null → "SSO configuration not found".
    const ctx = {
      runQuery: vi.fn().mockResolvedValue(null),
      runAction: vi.fn(),
    } as unknown as ActionCtx;

    const res = await ssoCallbackHandler(
      ctx,
      callbackRequest({ code: 'code', state }),
      { finishLogin: neverFinishes },
    );

    expect(res.status).toBe(302);
    const target = new URL(res.headers.get('Location') as string);
    expect(target.origin).toBe(PUBLIC_ORIGIN);
  });

  it('redirects a mapped IdP `?error=` callback to the public origin', async () => {
    const state = await signedState({
      redirectUri: `${PUBLIC_ORIGIN}/http_api/api/sso/callback`,
      timestamp: Date.now(),
      organizationId: 'org1',
    });
    const ctx = {
      runQuery: vi.fn(),
      runAction: vi.fn(),
    } as unknown as ActionCtx;

    const res = await ssoCallbackHandler(
      ctx,
      callbackRequest({
        error: 'access_denied',
        error_description:
          'AADSTS50105: Your administrator has configured the application to block users.',
        state,
      }),
      { finishLogin: neverFinishes },
    );

    expect(res.status).toBe(302);
    const target = new URL(res.headers.get('Location') as string);
    expect(target.origin).toBe(PUBLIC_ORIGIN);
    expect(target.searchParams.get('error')).toBe('sso.errors.userNotAssigned');
  });
});

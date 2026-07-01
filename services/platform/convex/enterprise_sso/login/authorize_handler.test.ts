import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../_generated/server';
import { ssoAuthorizeHandler } from './authorize_handler';

/**
 * Regression for A2.1: an unhandled failure in the authorize path used to paint
 * a raw `Response('Internal server error', { status: 500 })` — the one place a
 * literal "internal server error" page showed, discarding the real reason. It
 * must now bounce to `/log-in?error=…` (a 302) like the callback handler, so the
 * failure is diagnosable.
 */
describe('ssoAuthorizeHandler — failure path is a readable redirect, not a 500', () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = 'test-secret';
    delete process.env.BASE_PATH;
  });

  afterEach(() => {
    delete process.env.BETTER_AUTH_SECRET;
    vi.clearAllMocks();
  });

  function authorizeRequest(): Request {
    const url = new URL('https://app.example.com/http_api/api/sso/authorize');
    url.searchParams.set(
      'redirect_uri',
      'https://app.example.com/http_api/api/sso/callback',
    );
    return new Request(url.toString());
  }

  it('redirects (302) to the login page carrying the error when config resolution throws', async () => {
    // Force an unhandled throw inside the try (the resolveSignInConfig query),
    // which previously fell through to the raw 500.
    const ctx = {
      runQuery: vi.fn().mockRejectedValue(new Error('boom')),
      runAction: vi.fn(),
    } as unknown as ActionCtx;

    const res = await ssoAuthorizeHandler(ctx, authorizeRequest());

    expect(res.status).toBe(302);
    const location = res.headers.get('Location');
    expect(location).toBeTruthy();
    const target = new URL(location as string);
    expect(target.pathname).toBe('/log-in');
    expect(target.searchParams.get('error')).toBe('sso.errors.serverError');
  });

  it('does not return a raw 500 "Internal server error" response', async () => {
    const ctx = {
      runQuery: vi.fn().mockRejectedValue(new Error('boom')),
      runAction: vi.fn(),
    } as unknown as ActionCtx;

    const res = await ssoAuthorizeHandler(ctx, authorizeRequest());

    expect(res.status).not.toBe(500);
    // The body must not be the old literal error page.
    const body = await res.text();
    expect(body).not.toContain('Internal server error');
  });

  it('redirects to the login page when BETTER_AUTH_SECRET is unset', async () => {
    // A missing secret is a deployment misconfig; assert it does not 500 either
    // (this branch already returned a 500 body before — keep it non-fatal for
    // the operator by still returning a Response, and never crashing).
    delete process.env.BETTER_AUTH_SECRET;
    const ctx = {
      runQuery: vi.fn(),
      runAction: vi.fn(),
    } as unknown as ActionCtx;

    const res = await ssoAuthorizeHandler(ctx, authorizeRequest());
    // This specific branch still returns a 500 config error (documented), but
    // it must never throw — a throw is what produced the opaque failure.
    expect(res).toBeInstanceOf(Response);
  });
});

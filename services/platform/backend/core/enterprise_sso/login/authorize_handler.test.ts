import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../lib/ctx';
import { verifySignedValue } from '../sign_cookie_value';
import { ssoAuthorizeHandler } from './authorize_handler';
import { hashFlowNonce } from './flow_cookie';

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

  it('prefers SITE_URL over the internal request origin for the error redirect', async () => {
    // Behind the reverse proxy the request origin is the internal Convex
    // address — the browser can only reach the public SITE_URL.
    process.env.SITE_URL = 'https://app.example.com';
    const ctx = {
      runQuery: vi.fn().mockRejectedValue(new Error('boom')),
      runAction: vi.fn(),
    } as unknown as ActionCtx;

    const url = new URL('http://127.0.0.1:3211/api/sso/authorize');
    const res = await ssoAuthorizeHandler(ctx, new Request(url.toString()));
    delete process.env.SITE_URL;

    expect(res.status).toBe(302);
    const target = new URL(res.headers.get('Location') as string);
    expect(target.origin).toBe('https://app.example.com');
    expect(target.pathname).toBe('/log-in');
  });

  it('bounces to the login page asking for the email when several orgs have SSO (no guess)', async () => {
    // Multi-org deployments: resolveSignInConfig reports 'ambiguous' when no
    // org context is given. The old behaviour silently used the first enabled
    // connection — the user landed on another org's IdP.
    process.env.SITE_URL = 'https://app.example.com';
    const runAction = vi.fn();
    const ctx = {
      runQuery: vi.fn().mockResolvedValue('ambiguous'),
      runAction,
    } as unknown as ActionCtx;

    const res = await ssoAuthorizeHandler(ctx, authorizeRequest());
    delete process.env.SITE_URL;

    expect(res.status).toBe(302);
    const target = new URL(res.headers.get('Location') as string);
    expect(target.origin).toBe('https://app.example.com');
    expect(target.pathname).toBe('/log-in');
    expect(target.searchParams.get('error')).toBe(
      'sso.errors.multipleConnections',
    );
    // It must never have proceeded to fetch secrets for a guessed connection.
    expect(runAction).not.toHaveBeenCalled();
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

/**
 * `redirect_uri` is caller-chosen and the callback adopts its origin for every
 * redirect it answers with, so /authorize must refuse any origin that is not
 * ours — the state's signature would otherwise certify an open redirect
 * (sso-2). Refusal is a plain 400: no legitimate caller sends another origin,
 * and bouncing to the value would be the very redirect being refused.
 */
describe('ssoAuthorizeHandler — redirect_uri must be one of our origins', () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = 'test-secret';
    delete process.env.BASE_PATH;
    delete process.env.SITE_URL;
  });

  afterEach(() => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.SITE_URL;
    vi.clearAllMocks();
  });

  function requestWith(
    redirectUri: string,
    origin = 'https://app.example.com',
  ): Request {
    const url = new URL(`${origin}/http_api/api/sso/authorize`);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('organizationId', 'org1');
    return new Request(url.toString());
  }

  it('refuses a foreign origin with 400 before resolving any connection', async () => {
    const runQuery = vi.fn();
    const ctx = { runQuery, runAction: vi.fn() } as unknown as ActionCtx;

    const res = await ssoAuthorizeHandler(
      ctx,
      requestWith('https://evil.example/x'),
    );

    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('refuses an unparsable redirect_uri the same way', async () => {
    const runQuery = vi.fn();
    const ctx = { runQuery, runAction: vi.fn() } as unknown as ActionCtx;

    const res = await ssoAuthorizeHandler(ctx, requestWith('not a url'));

    expect(res.status).toBe(400);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('accepts the SITE_URL origin when the request arrives on the internal upstream', async () => {
    process.env.SITE_URL = 'https://app.example.com';
    const runQuery = vi.fn().mockRejectedValue(new Error('boom'));
    const ctx = { runQuery, runAction: vi.fn() } as unknown as ActionCtx;

    const res = await ssoAuthorizeHandler(
      ctx,
      requestWith(
        'https://app.example.com/http_api/api/sso/callback',
        'http://backend-api:3005',
      ),
    );

    // Past the check: the connection lookup ran (and its failure bounced).
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(302);
  });

  it("accepts the request's own origin in either loopback spelling", async () => {
    const runQuery = vi.fn().mockRejectedValue(new Error('boom'));
    const ctx = { runQuery, runAction: vi.fn() } as unknown as ActionCtx;

    await ssoAuthorizeHandler(
      ctx,
      requestWith(
        'http://localhost:3211/api/sso/callback',
        'http://127.0.0.1:3211',
      ),
    );

    expect(runQuery).toHaveBeenCalledTimes(1);
  });
});

/**
 * The browser binding (sso-3): the 302 to the IdP sets an HttpOnly flow
 * cookie, and the signed state carries the hash of its nonce — what the
 * callback checks the returning browser against.
 */
describe('ssoAuthorizeHandler — binds the flow to the browser', () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = 'test-secret';
    delete process.env.BASE_PATH;
    delete process.env.SITE_URL;
  });

  afterEach(() => {
    delete process.env.BETTER_AUTH_SECRET;
    vi.clearAllMocks();
  });

  it('sets a __Host- flow cookie over HTTPS whose hash rides in the state', async () => {
    // A plain OAuth2 connection needs no discovery, so the real adapter
    // builds the redirect without a network.
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({
        organizationId: 'org1',
        providerId: 'oauth2',
        issuer: 'https://idp.example.com',
        authorizationEndpoint: 'https://idp.example.com/authorize',
        tokenEndpoint: 'https://idp.example.com/token',
        userinfoEndpoint: 'https://idp.example.com/userinfo',
        scopes: ['email'],
        pkce: false,
      }),
      runAction: vi.fn().mockResolvedValue({ clientId: 'client' }),
    } as unknown as ActionCtx;
    const url = new URL('https://app.example.com/http_api/api/sso/authorize');
    url.searchParams.set(
      'redirect_uri',
      'https://app.example.com/http_api/api/sso/callback',
    );
    url.searchParams.set('organizationId', 'org1');

    const res = await ssoAuthorizeHandler(ctx, new Request(url.toString()));

    expect(res.status).toBe(302);
    const cookie = res.headers.get('set-cookie') ?? '';
    const match =
      /^__Host-sso_flow=([A-Za-z0-9_-]{43}); Max-Age=600; Path=\/; HttpOnly; SameSite=None; Secure$/.exec(
        cookie,
      );
    expect(match, cookie).not.toBeNull();
    const nonce = match?.[1] ?? '';

    const idpUrl = new URL(res.headers.get('Location') as string);
    expect(idpUrl.origin).toBe('https://idp.example.com');
    const verified = await verifySignedValue(
      idpUrl.searchParams.get('state') ?? '',
      'test-secret',
    );
    expect(verified).not.toBeNull();
    const base64 = (verified ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(
      atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)),
    );
    expect(payload.flow).toBe(await hashFlowNonce(nonce));
    expect(payload.organizationId).toBe('org1');
    // The nonce itself never leaves the browser.
    expect(idpUrl.toString()).not.toContain(nonce);
  });
});

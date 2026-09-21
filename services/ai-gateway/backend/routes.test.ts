import { describe, expect, it, vi } from 'vitest';

import { AccountError, type AccountService } from './accounts';
import { createProviderRegistry } from './providers/index';
import { createApi, createApiDispatcher } from './routes';
import { createSessionSigner, SESSION_COOKIE_NAME } from './session';
import type { AccountView } from './store';

const PANEL_PASSWORD = 'panel-password';
const API_KEY = 'the-api-key';

const view: AccountView = {
  id: 'account-1',
  provider: 'anthropic',
  label: 'you@example.com',
  accountEmail: 'you@example.com',
  plan: null,
  status: 'active',
  expiresAt: null,
  scopes: null,
  createdAt: '2026-09-21T10:00:00.000Z',
  lastRefreshedAt: null,
  usage: null,
};

function build(overrides: Partial<AccountService> = {}) {
  const accounts: AccountService = {
    list: vi.fn(() => Promise.resolve([view])),
    beginAuthorization: vi.fn(() =>
      Promise.resolve({
        state: 'state-1',
        authorizeUrl: 'https://example.test/authorize',
        callbackStyle: 'code' as const,
      }),
    ),
    completeAuthorization: vi.fn(() => Promise.resolve(view)),
    remove: vi.fn(() => Promise.resolve(true)),
    cliCommand: vi.fn(() => Promise.resolve('FAKE_TOKEN=access-1 fake')),
    refreshAll: vi.fn(() => Promise.resolve()),
    handOutTokens: vi.fn(() =>
      Promise.resolve([
        {
          id: 'account-1',
          provider: 'anthropic' as const,
          label: 'you@example.com',
          accountEmail: 'you@example.com',
          accountId: null,
          status: 'active' as const,
          accessToken: 'access-1',
          expiresAt: null,
          scopes: null,
          envVar: 'ANTHROPIC_AUTH_TOKEN',
        },
      ]),
    ),
    ...overrides,
  };

  const session = createSessionSigner('session-secret');
  // The real registry: building it touches no network, and the catalog the
  // panel reads should be the one the gateway would actually offer.
  const providers = createProviderRegistry();

  const api = createApi({
    accounts,
    providers,
    session,
    panelPassword: PANEL_PASSWORD,
    apiKey: API_KEY,
  });

  const cookie = `${SESSION_COOKIE_NAME}=${session.issue()}`;
  const call = (
    path: string,
    init?: RequestInit,
    origin = 'http://gateway.test',
  ) => api.fetch(new Request(`${origin}${path}`, init));

  return { accounts, api, call, cookie };
}

describe('the panel session', () => {
  it('reports a browser with no cookie as signed out', async () => {
    const { call } = build();
    const response = await call('/api/session');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it('refuses the wrong password', async () => {
    const { call } = build();
    const response = await call('/api/session', {
      method: 'POST',
      body: JSON.stringify({ password: 'nope' }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'invalid_password' },
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a request that carries no password at all', async () => {
    const { call } = build();
    const response = await call('/api/session', { method: 'POST' });
    expect(response.status).toBe(400);
  });

  it('mints an http-only, same-site cookie for the right password', async () => {
    const { call } = build();
    const response = await call('/api/session', {
      method: 'POST',
      body: JSON.stringify({ password: PANEL_PASSWORD }),
    });
    expect(response.status).toBe(204);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('marks the cookie Secure over TLS and not over plain HTTP', async () => {
    const { call } = build();
    const body = JSON.stringify({ password: PANEL_PASSWORD });

    const plain = await call('/api/session', { method: 'POST', body });
    expect(plain.headers.get('set-cookie')).not.toContain('Secure');

    const tls = await call(
      '/api/session',
      { method: 'POST', body },
      'https://gateway.test',
    );
    expect(tls.headers.get('set-cookie')).toContain('Secure');
  });

  it('trusts a terminating proxy that says the hop was TLS', async () => {
    const { call } = build();
    const response = await call('/api/session', {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ password: PANEL_PASSWORD }),
    });
    expect(response.headers.get('set-cookie')).toContain('Secure');
  });

  it('clears the cookie on sign-out', async () => {
    const { call } = build();
    const response = await call('/api/session', { method: 'DELETE' });
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('the panel door', () => {
  const paths = [
    ['GET', '/api/accounts'],
    ['GET', '/api/providers'],
    ['POST', '/api/accounts/authorize'],
    ['POST', '/api/accounts/complete'],
    ['GET', '/api/accounts/account-1/command'],
    ['DELETE', '/api/accounts/account-1'],
  ] as const;

  it.each(paths)('refuses %s %s without a session', async (method, path) => {
    const { call } = build();
    const response = await call(path, { method });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'not_signed_in' },
    });
  });

  it.each(paths)(
    'refuses %s %s to a holder of the API key alone',
    async (method, path) => {
      const { call } = build();
      const response = await call(path, {
        method,
        headers: { authorization: `Bearer ${API_KEY}` },
      });
      expect(response.status).toBe(401);
    },
  );

  it('lists the accounts for a signed-in browser', async () => {
    const { call, cookie } = build();
    const response = await call('/api/accounts', { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accounts: [view] });
  });

  it('describes the providers it can add', async () => {
    const { call, cookie } = build();
    const response = await call('/api/providers', { headers: { cookie } });
    expect(await response.json()).toEqual({
      providers: [
        { id: 'anthropic', callbackStyle: 'code' },
        { id: 'openai', callbackStyle: 'redirect-url' },
      ],
    });
  });

  it('starts an authorization for a known provider only', async () => {
    const { call, cookie } = build();
    const ok = await call('/api/accounts/authorize', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic' }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ state: 'state-1' });

    const bad = await call('/api/accounts/authorize', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini' }),
    });
    expect(bad.status).toBe(400);
  });

  it('answers a completed authorization with the new account', async () => {
    const { call, cookie } = build();
    const response = await call('/api/accounts/complete', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'state-1', pasted: 'code-1' }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ account: view });
  });

  it('turns an account failure into its own code and status', async () => {
    const { call, cookie } = build({
      completeAuthorization: vi.fn(() =>
        Promise.reject(
          new AccountError('unknown_state', 'That authorization expired.'),
        ),
      ),
    });
    const response = await call('/api/accounts/complete', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'state-1', pasted: 'code-1' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'unknown_state' },
    });
  });

  it('answers 404 for a command or delete on an account that is gone', async () => {
    const { call, cookie } = build({
      cliCommand: vi.fn(() => Promise.resolve(null)),
      remove: vi.fn(() => Promise.resolve(false)),
    });
    expect(
      (await call('/api/accounts/gone/command', { headers: { cookie } }))
        .status,
    ).toBe(404);
    expect(
      (
        await call('/api/accounts/gone', {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(404);
  });
});

describe('the token endpoint', () => {
  it('refuses a request with no key', async () => {
    const { call } = build();
    const response = await call('/api/tokens');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('refuses the wrong key', async () => {
    const { call } = build();
    const response = await call('/api/tokens', {
      headers: { authorization: 'Bearer wrong' },
    });
    expect(response.status).toBe(401);
  });

  it('refuses a panel session — the two doors are separate', async () => {
    const { call, cookie } = build();
    expect((await call('/api/tokens', { headers: { cookie } })).status).toBe(
      401,
    );
  });

  it('hands out every token for the right key', async () => {
    const { call } = build();
    const response = await call('/api/tokens', {
      headers: { authorization: `Bearer ${API_KEY}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      tokens: [{ accessToken: 'access-1', envVar: 'ANTHROPIC_AUTH_TOKEN' }],
    });
  });

  it('accepts the x-api-key spelling too', async () => {
    const { call } = build();
    const response = await call('/api/tokens', {
      headers: { 'x-api-key': API_KEY },
    });
    expect(response.status).toBe(200);
  });
});

describe('createApiDispatcher', () => {
  it('claims the gateway routes and leaves everything else alone', () => {
    const { api } = build();
    const dispatch = createApiDispatcher(api);
    const at = (path: string) =>
      dispatch(
        new Request(`http://gateway.test${path}`),
        new URL(`http://gateway.test${path}`),
      );

    expect(at('/api/session')).not.toBeNull();
    // The shared React server owns the health probe and the SPA.
    expect(at('/api/health')).toBeNull();
    expect(at('/')).toBeNull();
    expect(at('/assets/index.js')).toBeNull();
  });
});

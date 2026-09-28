import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  AccountError,
  type AccountService,
  type TokenHandout,
} from './accounts';
import { createProviderRegistry } from './providers/index';
import type { ProviderId } from './providers/types';
import { createApi, createApiDispatcher } from './routes';
import type { AccountView } from './store';

const API_KEY = 'the-api-key';

const view: AccountView = {
  id: 'account-1',
  provider: 'anthropic',
  label: 'you@example.com',
  accountEmail: 'you@example.com',
  subscription: null,
  status: 'active',
  expiresAt: null,
  scopes: null,
  createdAt: '2026-09-21T10:00:00.000Z',
  lastRefreshedAt: null,
  usage: null,
};

const claude: TokenHandout = {
  id: 'account-1',
  provider: 'anthropic',
  label: 'you@example.com',
  accountEmail: 'you@example.com',
  accountId: null,
  status: 'active',
  accessToken: 'sk-ant-oat01-access-1',
  expiresAt: '2026-10-21T09:40:00.000Z',
  refreshAt: '2026-10-21T07:12:30.000Z',
  scopes: 'user:inference',
  available: false,
  availableAt: '2026-09-23T10:00:00.000Z',
  hold: 'quota',
  usage: {
    checkedAt: '2026-09-21T10:00:00.000Z',
    windows: [
      {
        kind: 'weekly',
        label: null,
        utilization: 100,
        resetsAt: '2026-09-23T10:00:00.000Z',
        windowSeconds: 604_800,
      },
    ],
  },
};

const chatgpt: TokenHandout = {
  id: 'account-2',
  provider: 'openai',
  label: 'you@example.org',
  accountEmail: 'you@example.org',
  accountId: 'chatgpt-account-2',
  status: 'active',
  accessToken: 'codex-access-2',
  expiresAt: null,
  refreshAt: null,
  scopes: null,
  available: true,
  availableAt: null,
  hold: null,
  usage: null,
};

const pool = [claude, chatgpt];

function build(overrides: Partial<AccountService> = {}) {
  // Held as a local so assertions never reference the method off the object
  // (an unbound method reference), and so an override cannot make it stale.
  const handOutTokens = vi.fn((provider?: ProviderId) =>
    Promise.resolve(
      provider === undefined
        ? pool
        : pool.filter((handout) => handout.provider === provider),
    ),
  );

  const accounts: AccountService = {
    list: vi.fn(() => Promise.resolve([view])),
    beginAuthorization: vi.fn(() =>
      Promise.resolve({
        state: 'state-1',
        flow: 'paste' as const,
        authorizeUrl: 'https://example.test/authorize',
        pasteStyle: 'code' as const,
      }),
    ),
    completeAuthorization: vi.fn(() => Promise.resolve(view)),
    completeRedirect: vi.fn(() =>
      Promise.resolve({ status: 'connected' as const, account: view }),
    ),
    authorizationStatus: vi.fn(() =>
      Promise.resolve({ status: 'pending' as const }),
    ),
    remove: vi.fn(() => Promise.resolve(true)),
    cliCommand: vi.fn(() => Promise.resolve('FAKE_TOKEN=access-1 fake')),
    refreshAll: vi.fn(() => Promise.resolve()),
    handOutTokens,
    ...overrides,
  };

  // The real registry: building it touches no network, and the catalog the
  // panel reads should be the one the gateway would actually offer.
  const providers = createProviderRegistry();
  const api = createApi({ accounts, providers, apiKey: API_KEY });

  const call = (path: string, init?: RequestInit) =>
    api.fetch(new Request(`http://gateway.test${path}`, init));

  return { api, call, handOutTokens };
}

const withKey = { authorization: `Bearer ${API_KEY}` };

describe('the panel routes', () => {
  const paths = [
    ['GET', '/api/accounts'],
    ['GET', '/api/providers'],
    ['GET', '/api/accounts/account-1/command'],
  ] as const;

  // The panel has no login of its own: whatever fronts the gateway decides
  // who reaches it, and the app asks a browser for nothing.
  it.each(paths)(
    'serves %s %s to a browser with no credential',
    async (method, path) => {
      const { call } = build();
      expect((await call(path, { method })).status).toBe(200);
    },
  );

  it('lists the accounts', async () => {
    const { call } = build();
    const response = await call('/api/accounts');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accounts: [view] });
  });

  it('does not cache copied credentials', async () => {
    const { call } = build();
    expect(
      (await call('/api/accounts/account-1/command')).headers.get(
        'cache-control',
      ),
    ).toBe('no-store');
  });

  it('describes the providers it can add', async () => {
    const { call } = build();
    const response = await call('/api/providers');
    expect(await response.json()).toEqual({
      providers: [{ id: 'anthropic' }, { id: 'openai' }],
    });
  });

  it('starts an authorization for a known provider only', async () => {
    const { call } = build();
    const ok = await call('/api/accounts/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic' }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ state: 'state-1' });

    const bad = await call('/api/accounts/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini' }),
    });
    expect(bad.status).toBe(400);
  });

  it('decides the way back from the origin the browser sent, not from the body', async () => {
    const beginAuthorization = vi.fn(() =>
      Promise.resolve({
        state: 'state-1',
        flow: 'redirect' as const,
        authorizeUrl: 'https://example.test/authorize',
      }),
    );
    const { call } = build({ beginAuthorization });
    await call('/api/accounts/authorize', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3004',
      },
      body: JSON.stringify({
        provider: 'anthropic',
        label: 'work',
        method: 'browser',
        // Not a field the route reads: page script cannot forge `Origin`,
        // but it can write anything into a body.
        loopbackOrigin: 'http://localhost:9999',
      }),
    });
    expect(beginAuthorization).toHaveBeenCalledWith({
      provider: 'anthropic',
      accountId: null,
      label: 'work',
      loopbackOrigin: 'http://localhost:3004',
      preferBrowser: true,
    });
  });

  it('says where an authorization stands, and never lets that be cached', async () => {
    const authorizationStatus = vi.fn(() =>
      Promise.resolve({ status: 'pending' as const }),
    );
    const { call } = build({ authorizationStatus });
    const response = await call('/api/accounts/authorize/state-1');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'pending' });
    expect(authorizationStatus).toHaveBeenCalledWith('state-1');
  });

  it('answers a vendor that could not be reached as a bad gateway', async () => {
    const { call } = build({
      beginAuthorization: vi.fn(() =>
        Promise.reject(new AccountError('unavailable', 'OpenAI is down.')),
      ),
    });
    const response = await call('/api/accounts/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai' }),
    });
    expect(response.status).toBe(502);
  });

  it('answers a completed authorization with the new account', async () => {
    const { call } = build();
    const response = await call('/api/accounts/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'state-1', pasted: 'code-1' }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ account: view });
  });

  it('turns an account failure into its own code and status', async () => {
    const { call } = build({
      completeAuthorization: vi.fn(() =>
        Promise.reject(
          new AccountError('unknown_state', 'That authorization expired.'),
        ),
      ),
    });
    const response = await call('/api/accounts/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'state-1', pasted: 'code-1' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'unknown_state' },
    });
  });

  it('answers 404 for a command or delete on an account that is gone', async () => {
    const { call } = build({
      cliCommand: vi.fn(() => Promise.resolve(null)),
      remove: vi.fn(() => Promise.resolve(false)),
    });
    expect((await call('/api/accounts/gone/command')).status).toBe(404);
    expect(
      (await call('/api/accounts/gone', { method: 'DELETE' })).status,
    ).toBe(404);
  });
});

describe('the token endpoints', () => {
  const paths = [
    '/api/tokens',
    '/api/tokens/anthropic',
    '/api/tokens/openai',
  ] as const;

  it.each(paths)('refuses %s with no key', async (path) => {
    const { call } = build();
    const response = await call(path);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(await response.json()).toMatchObject({
      error: { code: 'invalid_api_key' },
    });
  });

  it.each(paths)('refuses %s with the wrong key', async (path) => {
    const { call } = build();
    const response = await call(path, {
      headers: { authorization: 'Bearer wrong' },
    });
    expect(response.status).toBe(401);
  });

  it.each(paths)('accepts the x-api-key spelling on %s', async (path) => {
    const { call } = build();
    expect(
      (await call(path, { headers: { 'x-api-key': API_KEY } })).status,
    ).toBe(200);
  });

  it.each(paths)(
    'does not cache %s, including failed authentication',
    async (path) => {
      const { call } = build();
      expect(
        (await call(path, { headers: withKey })).headers.get('cache-control'),
      ).toBe('no-store');
      expect((await call(path)).headers.get('cache-control')).toBe('no-store');
    },
  );

  it('keeps cc-gateway fields and adds stable identity and quota metadata', async () => {
    const { call } = build();
    const response = await call('/api/tokens/anthropic', { headers: withKey });
    expect(await response.json()).toEqual({
      tokens: [
        {
          id: 'account-1',
          provider: 'anthropic',
          account_id: null,
          label: 'you@example.com',
          account_email: 'you@example.com',
          status: 'active',
          access_token: 'sk-ant-oat01-access-1',
          expires_at: '2026-10-21T09:40:00.000Z',
          refresh_at: '2026-10-21T07:12:30.000Z',
          scopes: 'user:inference',
          available: false,
          available_at: '2026-09-23T10:00:00.000Z',
          hold: 'quota',
          usage: {
            checked_at: '2026-09-21T10:00:00.000Z',
            limited: null,
            windows: [
              {
                kind: 'weekly',
                label: null,
                utilization: 100,
                resets_at: '2026-09-23T10:00:00.000Z',
                window_seconds: 604_800,
              },
            ],
          },
        },
      ],
    });
  });

  it('reports the planned refresh beside the vendor expiry, as the end of the token’s life', async () => {
    const { call } = build();
    const response = await call('/api/tokens/anthropic', { headers: withKey });
    const body = z
      .object({
        tokens: z.array(
          z.object({ expires_at: z.string(), refresh_at: z.string() }),
        ),
      })
      .parse(await response.json());
    // `expires_at` keeps cc-gateway's meaning, the vendor's own expiry;
    // `refresh_at` is when this gateway's refresh ends the token, earlier.
    expect(body.tokens).toEqual([
      {
        expires_at: '2026-10-21T09:40:00.000Z',
        refresh_at: '2026-10-21T07:12:30.000Z',
      },
    ]);
  });

  it('says why an account waits, so a consumer can tell the floor from a spent quota', async () => {
    const floorHeld: TokenHandout = {
      ...claude,
      id: 'account-3',
      accessToken: 'sk-ant-oat01-access-3',
      available: false,
      availableAt: '2026-10-21T07:12:30.000Z',
      hold: 'refresh',
      usage: null,
    };
    const { call } = build({
      handOutTokens: vi.fn(() => Promise.resolve([claude, floorHeld])),
    });
    const response = await call('/api/tokens/anthropic', { headers: withKey });
    const body = z
      .object({
        tokens: z.array(
          z.object({
            id: z.string(),
            available: z.boolean(),
            available_at: z.string().nullable(),
            hold: z.enum(['quota', 'refresh']).nullable(),
          }),
        ),
      })
      .parse(await response.json());
    // `available` keeps its meaning for a consumer that reads nothing else;
    // `hold` tells the refresh floor, which a consumer may fall back to,
    // from a spent quota, which it may not.
    expect(body.tokens).toEqual([
      {
        id: 'account-1',
        available: false,
        available_at: '2026-09-23T10:00:00.000Z',
        hold: 'quota',
      },
      {
        id: 'account-3',
        available: false,
        available_at: '2026-10-21T07:12:30.000Z',
        hold: 'refresh',
      },
    ]);
  });

  it('hands out only Claude tokens on the Anthropic endpoint', async () => {
    const { call, handOutTokens } = build();
    const response = await call('/api/tokens/anthropic', { headers: withKey });
    expect(await response.json()).toMatchObject({
      tokens: [{ id: 'account-1' }],
    });
    // Narrowed in the service, not filtered here: an OpenAI account must not
    // be refreshed to answer a request for Anthropic's tokens.
    expect(handOutTokens).toHaveBeenCalledWith('anthropic');
  });

  it('hands out only ChatGPT tokens on the OpenAI endpoint', async () => {
    const { call, handOutTokens } = build();
    const response = await call('/api/tokens/openai', { headers: withKey });
    expect(await response.json()).toEqual({
      tokens: [
        {
          id: 'account-2',
          provider: 'openai',
          account_id: 'chatgpt-account-2',
          label: 'you@example.org',
          account_email: 'you@example.org',
          status: 'active',
          access_token: 'codex-access-2',
          expires_at: null,
          refresh_at: null,
          scopes: null,
          available: true,
          available_at: null,
          hold: null,
          usage: null,
        },
      ],
    });
    expect(handOutTokens).toHaveBeenCalledWith('openai');
  });

  it('never leaks one vendor’s token through the other’s endpoint', async () => {
    const { call } = build();
    const anthropic = await (
      await call('/api/tokens/anthropic', { headers: withKey })
    ).text();
    const openai = await (
      await call('/api/tokens/openai', { headers: withKey })
    ).text();
    expect(anthropic).not.toContain(chatgpt.accessToken);
    expect(openai).not.toContain(claude.accessToken);
  });

  it('answers an empty pool with an empty array, not a 404', async () => {
    const { call } = build({ handOutTokens: vi.fn(() => Promise.resolve([])) });
    const response = await call('/api/tokens/openai', { headers: withKey });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tokens: [] });
  });

  it('refuses a provider it does not hold', async () => {
    const { call, handOutTokens } = build();
    const response = await call('/api/tokens/gemini', { headers: withKey });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'unknown_provider' },
    });
    expect(handOutTokens).not.toHaveBeenCalled();
  });

  it('serves the whole pool on the combined endpoint, each token named by vendor', async () => {
    const { call, handOutTokens } = build();
    const response = await call('/api/tokens', { headers: withKey });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tokens: [
        {
          id: 'account-1',
          provider: 'anthropic',
          account_id: null,
          label: 'you@example.com',
          account_email: 'you@example.com',
          status: 'active',
          access_token: 'sk-ant-oat01-access-1',
          expires_at: '2026-10-21T09:40:00.000Z',
          refresh_at: '2026-10-21T07:12:30.000Z',
          scopes: 'user:inference',
          available: false,
          available_at: '2026-09-23T10:00:00.000Z',
          hold: 'quota',
          usage: {
            checked_at: '2026-09-21T10:00:00.000Z',
            limited: null,
            windows: [
              {
                kind: 'weekly',
                label: null,
                utilization: 100,
                resets_at: '2026-09-23T10:00:00.000Z',
                window_seconds: 604_800,
              },
            ],
          },
        },
        {
          id: 'account-2',
          provider: 'openai',
          account_id: 'chatgpt-account-2',
          label: 'you@example.org',
          account_email: 'you@example.org',
          status: 'active',
          access_token: 'codex-access-2',
          expires_at: null,
          refresh_at: null,
          scopes: null,
          available: true,
          available_at: null,
          hold: null,
          usage: null,
        },
      ],
    });
    expect(handOutTokens).toHaveBeenCalledWith();
  });

  it('keeps the key off the panel routes — the two audiences stay apart', async () => {
    const { call } = build();
    // Holding the key does not make the holder the panel, and the panel's
    // routes never answer with a credential.
    const command = await call('/api/accounts/account-1/command', {
      headers: withKey,
    });
    expect(await command.json()).toEqual({
      command: 'FAKE_TOKEN=access-1 fake',
    });
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

    expect(at('/api/accounts')).not.toBeNull();
    expect(at('/api/tokens/anthropic')).not.toBeNull();
    // Where a vendor's loopback redirect lands, outside `/api`.
    expect(at('/callback?state=state-1&code=code-1')).not.toBeNull();
    // The shared React server owns the health probe and the SPA.
    expect(at('/api/health')).toBeNull();
    expect(at('/')).toBeNull();
    expect(at('/assets/index.js')).toBeNull();
  });
});

describe('the vendor callback', () => {
  it('finishes the redirect and sends the browser back to the panel', async () => {
    const completeRedirect = vi.fn(() =>
      Promise.resolve({ status: 'connected' as const, account: view }),
    );
    const { call } = build({ completeRedirect });
    const response = await call('/callback?code=code-1&state=state-1');

    expect(completeRedirect).toHaveBeenCalledWith({
      state: 'state-1',
      code: 'code-1',
      error: null,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/?authorization=state-1');
  });

  it('carries a consent the person declined back to the panel too', async () => {
    const completeRedirect = vi.fn(() =>
      Promise.resolve({ status: 'failed' as const, code: 'denied' as const }),
    );
    const { call } = build({ completeRedirect });
    const response = await call('/callback?error=access_denied&state=state-1');
    expect(completeRedirect).toHaveBeenCalledWith({
      state: 'state-1',
      code: null,
      error: 'access_denied',
    });
    expect(response.headers.get('location')).toBe('/?authorization=state-1');
  });

  it('still ends on the panel when finishing throws', async () => {
    const { call } = build({
      completeRedirect: vi.fn(() => Promise.reject(new Error('disk full'))),
    });
    const response = await call('/callback?code=code-1&state=state-1');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/?authorization=state-1');
  });

  it('sends a callback with no state straight to the panel', async () => {
    const completeRedirect = vi.fn();
    const { call } = build({ completeRedirect });
    const response = await call('/callback?code=code-1');
    expect(completeRedirect).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('/');
  });
});

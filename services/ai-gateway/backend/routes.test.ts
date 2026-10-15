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
  state: 'available',
  limitedUntil: null,
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

function build(
  overrides: Partial<AccountService> = {},
  adminApiKey: string | null = null,
) {
  // Held as a local so assertions never reference the method off the object
  // (an unbound method reference), and so an override cannot make it stale.
  const handOutTokens = vi.fn((provider?: ProviderId) =>
    Promise.resolve(
      provider === undefined
        ? pool
        : pool.filter((handout) => handout.provider === provider),
    ),
  );

  // The calls a refusal must not reach, held the same way.
  const list = vi.fn(() => Promise.resolve([view]));
  const beginAuthorization = vi.fn(() =>
    Promise.resolve({
      state: 'state-1',
      flow: 'paste' as const,
      authorizeUrl: 'https://example.test/authorize',
      pasteStyle: 'code' as const,
    }),
  );
  const completeAuthorization = vi.fn(() => Promise.resolve(view));
  const authorizationStatus = vi.fn(() =>
    Promise.resolve({ status: 'pending' as const }),
  );
  const remove = vi.fn(() => Promise.resolve(true));

  const accounts: AccountService = {
    list,
    get: vi.fn((id: string) => Promise.resolve(id === view.id ? view : null)),
    beginAuthorization,
    completeAuthorization,
    completeRedirect: vi.fn(() =>
      Promise.resolve({ status: 'connected' as const, account: view }),
    ),
    authorizationStatus,
    remove,
    cliCommand: vi.fn(() => Promise.resolve('FAKE_TOKEN=access-1 fake')),
    refreshAll: vi.fn(() => Promise.resolve()),
    handOutTokens,
    ...overrides,
  };

  // The real registry: building it touches no network, and the catalog the
  // panel reads should be the one the gateway would actually offer.
  const providers = createProviderRegistry();
  const api = createApi({ accounts, providers, apiKey: API_KEY, adminApiKey });

  const call = (path: string, init?: RequestInit) =>
    api.fetch(new Request(`http://gateway.test${path}`, init));

  return {
    api,
    call,
    handOutTokens,
    calls: {
      list,
      beginAuthorization,
      completeAuthorization,
      authorizationStatus,
      remove,
    },
  };
}

const withKey = { authorization: `Bearer ${API_KEY}` };
const ADMIN_KEY = 'the-admin-key';
const withAdminKey = { authorization: `Bearer ${ADMIN_KEY}` };

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

  it('passes the broker retry refresh signal only to the token door', async () => {
    const { call, handOutTokens } = build();
    await call('/api/tokens/openai', {
      headers: {
        ...withKey,
        'x-tale-force-refresh': '1',
      },
    });

    expect(handOutTokens).toHaveBeenCalledWith('openai', {
      forceRefresh: true,
    });
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

describe('the accounts API', () => {
  const json = { 'content-type': 'application/json' };

  const limited: AccountView = {
    ...view,
    id: 'account-9',
    state: 'limited',
    limitedUntil: '2026-09-24T10:00:00.000Z',
    subscription: { plan: 'max', tier: '20x' },
    usage: {
      checkedAt: '2026-09-21T10:00:00.000Z',
      stale: false,
      limited: null,
      windows: [
        {
          kind: 'session',
          label: null,
          utilization: 100,
          resetsAt: '2026-09-21T10:05:00.000Z',
          windowSeconds: 18_000,
          blocking: true,
        },
        {
          kind: 'weekly',
          label: null,
          utilization: 100,
          resetsAt: '2026-09-24T10:00:00.000Z',
          windowSeconds: 604_800,
          blocking: true,
        },
      ],
    },
  };

  const reads = [
    ['GET', '/api/v1/accounts'],
    ['GET', '/api/v1/accounts/account-1'],
  ] as const;

  const changes = [
    ['POST', '/api/v1/authorizations', { provider: 'anthropic' }],
    ['GET', '/api/v1/authorizations/state-1', undefined],
    ['POST', '/api/v1/authorizations/state-1/complete', { pasted: 'code-1' }],
    ['DELETE', '/api/v1/accounts/account-1', undefined],
  ] as const;

  const all = [
    ...reads.map(([method, path]) => [method, path, undefined] as const),
    ...changes,
  ];

  function send(
    call: ReturnType<typeof build>['call'],
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return call(path, {
      method,
      headers: body === undefined ? headers : { ...json, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  describe('who may ask', () => {
    it.each(all)('refuses %s %s with no key', async (method, path, body) => {
      const { call } = build({}, ADMIN_KEY);
      const response = await send(call, method, path, body);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({
        error: { code: 'invalid_api_key' },
      });
    });

    it.each(all)(
      'refuses %s %s with a key that is neither',
      async (method, path, body) => {
        const { call } = build({}, ADMIN_KEY);
        const response = await send(call, method, path, body, {
          authorization: 'Bearer wrong',
        });
        expect(response.status).toBe(401);
      },
    );

    it.each(reads)('lets the token key read: %s %s', async (method, path) => {
      const { call } = build({}, ADMIN_KEY);
      expect((await send(call, method, path, undefined, withKey)).status).toBe(
        200,
      );
    });

    it.each(reads)('lets the admin key read: %s %s', async (method, path) => {
      const { call } = build({}, ADMIN_KEY);
      expect(
        (await send(call, method, path, undefined, withAdminKey)).status,
      ).toBe(200);
    });

    it.each(changes)(
      'keeps %s %s from the token key, which may only read',
      async (method, path, body) => {
        const { call, calls } = build({}, ADMIN_KEY);
        const response = await send(call, method, path, body, withKey);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: { code: 'admin_key_required' },
        });
        // Refused before the service heard of it.
        expect(calls.beginAuthorization).not.toHaveBeenCalled();
        expect(calls.completeAuthorization).not.toHaveBeenCalled();
        expect(calls.authorizationStatus).not.toHaveBeenCalled();
        expect(calls.remove).not.toHaveBeenCalled();
      },
    );

    it.each(changes)(
      'says %s %s is switched off while the gateway has no admin key',
      async (method, path, body) => {
        const { call, calls } = build({}, null);
        const response = await send(call, method, path, body, withKey);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: { code: 'control_disabled' },
        });
        expect(calls.remove).not.toHaveBeenCalled();
      },
    );

    it('still lets the token key read while changing is switched off', async () => {
      const { call } = build({}, null);
      expect(
        (await call('/api/v1/accounts', { headers: withKey })).status,
      ).toBe(200);
    });

    it('does not let a missing admin key be matched by an empty one', async () => {
      const { call } = build({}, null);
      const response = await call('/api/v1/accounts/account-1', {
        method: 'DELETE',
        headers: { authorization: 'Bearer ' },
      });
      expect(response.status).toBe(401);
    });

    it.each(changes)(
      'lets the admin key through to %s %s',
      async (method, path, body) => {
        const { call } = build({}, ADMIN_KEY);
        const response = await send(call, method, path, body, withAdminKey);
        expect(response.status).toBeLessThan(300);
      },
    );

    it('is one key when both are the same value', async () => {
      const api = build({}, API_KEY);
      const response = await send(
        api.call,
        'DELETE',
        '/api/v1/accounts/account-1',
        undefined,
        withKey,
      );
      expect(response.status).toBe(204);
    });

    it('takes the key in either spelling', async () => {
      const { call } = build({}, ADMIN_KEY);
      expect(
        (await call('/api/v1/accounts', { headers: { 'x-api-key': API_KEY } }))
          .status,
      ).toBe(200);
      expect(
        (
          await call('/api/v1/accounts/account-1', {
            method: 'DELETE',
            headers: { 'x-api-key': ADMIN_KEY },
          })
        ).status,
      ).toBe(204);
    });

    it('opens no panel route to a key, and no key route to a browser', async () => {
      const { call } = build({}, ADMIN_KEY);
      // The panel's routes still ask nothing…
      expect((await call('/api/accounts')).status).toBe(200);
      // …and the machine door's twin of the same list asks for a key.
      expect((await call('/api/v1/accounts')).status).toBe(401);
    });
  });

  describe('reading', () => {
    it('lists the pool without a credential, in the token door’s names', async () => {
      const { call } = build({ list: vi.fn(() => Promise.resolve([limited])) });
      const response = await call('/api/v1/accounts', { headers: withKey });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        accounts: [
          {
            id: 'account-9',
            provider: 'anthropic',
            label: 'you@example.com',
            account_email: 'you@example.com',
            subscription: { plan: 'max', tier: '20x' },
            status: 'active',
            state: 'limited',
            limited_until: '2026-09-24T10:00:00.000Z',
            expires_at: null,
            scopes: null,
            created_at: '2026-09-21T10:00:00.000Z',
            last_refreshed_at: null,
            usage: {
              checked_at: '2026-09-21T10:00:00.000Z',
              stale: false,
              limited: null,
              windows: [
                {
                  kind: 'session',
                  label: null,
                  utilization: 100,
                  resets_at: '2026-09-21T10:05:00.000Z',
                  window_seconds: 18_000,
                  blocking: true,
                },
                {
                  kind: 'weekly',
                  label: null,
                  utilization: 100,
                  resets_at: '2026-09-24T10:00:00.000Z',
                  window_seconds: 604_800,
                  blocking: true,
                },
              ],
            },
          },
        ],
      });
    });

    it('never puts a token, a refresh token or a secret on the wire', async () => {
      const { call } = build({ list: vi.fn(() => Promise.resolve([limited])) });
      const text = await (
        await call('/api/v1/accounts', { headers: withAdminKey })
      ).text();
      expect(text).not.toMatch(/access_token|refresh_token|accessToken/);
    });

    it('narrows the list by provider and by state', async () => {
      const claudeLimited = limited;
      const chatgptAvailable: AccountView = {
        ...view,
        id: 'account-2',
        provider: 'openai',
      };
      const { call } = build(
        {
          list: vi.fn(() =>
            Promise.resolve([claudeLimited, chatgptAvailable, view]),
          ),
        },
        ADMIN_KEY,
      );
      const ids = async (query: string) =>
        z
          .object({ accounts: z.array(z.object({ id: z.string() })) })
          .parse(
            await (
              await call(`/api/v1/accounts${query}`, { headers: withKey })
            ).json(),
          )
          .accounts.map((account) => account.id);

      expect(await ids('')).toEqual(['account-9', 'account-2', 'account-1']);
      expect(await ids('?provider=openai')).toEqual(['account-2']);
      expect(await ids('?state=limited')).toEqual(['account-9']);
      expect(await ids('?provider=anthropic&state=available')).toEqual([
        'account-1',
      ]);
    });

    it('refuses a provider or a state it does not know', async () => {
      const { call, calls } = build();
      for (const query of ['?provider=gemini', '?state=asleep']) {
        const response = await call(`/api/v1/accounts${query}`, {
          headers: withKey,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: { code: 'invalid_request' },
        });
      }
      expect(calls.list).not.toHaveBeenCalled();
    });

    it('answers one account, and 404 for one that is gone', async () => {
      const { call } = build();
      const found = await call('/api/v1/accounts/account-1', {
        headers: withKey,
      });
      expect(await found.json()).toMatchObject({
        account: { id: 'account-1', state: 'available', limited_until: null },
      });
      const gone = await call('/api/v1/accounts/gone', { headers: withKey });
      expect(gone.status).toBe(404);
      expect(await gone.json()).toMatchObject({
        error: { code: 'unknown_account' },
      });
    });
  });

  describe('changing', () => {
    it('starts an authorization that needs no browser on the gateway’s own machine', async () => {
      const beginAuthorization = vi.fn(() =>
        Promise.resolve({
          state: 'state-7',
          flow: 'device' as const,
          verificationUrl: 'https://auth.example.test/device',
          userCode: 'ABCD-1234',
          expiresAt: '2026-09-21T10:15:00.000Z',
          pollIntervalSeconds: 5,
        }),
      );
      const { call } = build({ beginAuthorization }, ADMIN_KEY);
      const response = await send(
        call,
        'POST',
        '/api/v1/authorizations',
        {
          provider: 'openai',
          label: 'work',
          method: 'browser',
          account_id: 'account-2',
          // Not read: a script has no `Origin`, and the body cannot name one.
          loopbackOrigin: 'http://localhost:9999',
        },
        // Even a browser-like caller does not get a redirect flow from here.
        { ...withAdminKey, origin: 'http://localhost:3004' },
      );
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        authorization: {
          state: 'state-7',
          flow: 'device',
          verification_url: 'https://auth.example.test/device',
          user_code: 'ABCD-1234',
          expires_at: '2026-09-21T10:15:00.000Z',
          poll_interval_seconds: 5,
        },
      });
      expect(beginAuthorization).toHaveBeenCalledWith({
        provider: 'openai',
        accountId: 'account-2',
        label: 'work',
        loopbackOrigin: null,
        preferBrowser: true,
      });
    });

    it('tells a script how to finish a paste flow', async () => {
      const { call } = build({}, ADMIN_KEY);
      const response = await send(
        call,
        'POST',
        '/api/v1/authorizations',
        { provider: 'anthropic' },
        withAdminKey,
      );
      expect(await response.json()).toEqual({
        authorization: {
          state: 'state-1',
          flow: 'paste',
          authorize_url: 'https://example.test/authorize',
          paste_style: 'code',
        },
      });
    });

    it('refuses to start an authorization for a provider it does not hold', async () => {
      const { call, calls } = build({}, ADMIN_KEY);
      for (const body of [{ provider: 'gemini' }, {}, null]) {
        const response = await send(
          call,
          'POST',
          '/api/v1/authorizations',
          body,
          withAdminKey,
        );
        expect(response.status).toBe(400);
      }
      expect(calls.beginAuthorization).not.toHaveBeenCalled();
    });

    it('says where an authorization stands, and what it connected', async () => {
      const authorizationStatus = vi
        .fn<AccountService['authorizationStatus']>()
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'connected', account: limited })
        .mockResolvedValueOnce({ status: 'failed', code: 'denied' });
      const { call } = build({ authorizationStatus }, ADMIN_KEY);
      const read = async () =>
        (
          await call('/api/v1/authorizations/state-1', {
            headers: withAdminKey,
          })
        ).json();

      expect(await read()).toEqual({
        authorization: { state: 'state-1', status: 'pending' },
      });
      expect(await read()).toMatchObject({
        authorization: {
          state: 'state-1',
          status: 'connected',
          account: { id: 'account-9', state: 'limited' },
        },
      });
      expect(await read()).toEqual({
        authorization: { state: 'state-1', status: 'failed', code: 'denied' },
      });
    });

    it('completes a paste flow with what the person copied', async () => {
      const completeAuthorization = vi.fn(() => Promise.resolve(limited));
      const { call } = build({ completeAuthorization }, ADMIN_KEY);
      const response = await send(
        call,
        'POST',
        '/api/v1/authorizations/state-1/complete',
        { pasted: 'code-1#state-1' },
        withAdminKey,
      );
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        account: { id: 'account-9', state: 'limited' },
      });
      expect(completeAuthorization).toHaveBeenCalledWith({
        state: 'state-1',
        pasted: 'code-1#state-1',
      });

      const empty = await send(
        call,
        'POST',
        '/api/v1/authorizations/state-1/complete',
        { pasted: '' },
        withAdminKey,
      );
      expect(empty.status).toBe(400);
    });

    it('answers a refused authorization with its own code, as the panel does', async () => {
      const { call } = build(
        {
          completeAuthorization: vi.fn(() =>
            Promise.reject(
              new AccountError('unknown_state', 'That authorization expired.'),
            ),
          ),
          beginAuthorization: vi.fn(() =>
            Promise.reject(new AccountError('unavailable', 'OpenAI is down.')),
          ),
        },
        ADMIN_KEY,
      );
      const complete = await send(
        call,
        'POST',
        '/api/v1/authorizations/state-1/complete',
        { pasted: 'x' },
        withAdminKey,
      );
      expect(complete.status).toBe(400);
      expect(await complete.json()).toMatchObject({
        error: { code: 'unknown_state' },
      });
      const start = await send(
        call,
        'POST',
        '/api/v1/authorizations',
        { provider: 'openai' },
        withAdminKey,
      );
      expect(start.status).toBe(502);
    });

    it('leaves one line for every change that went through and none for a refusal', async () => {
      const info = vi
        .spyOn(console, 'info')
        .mockImplementation(() => undefined);
      try {
        const { call } = build(
          {
            // A device code connects its account in a status read.
            authorizationStatus: vi.fn(() =>
              Promise.resolve({ status: 'connected' as const, account: view }),
            ),
          },
          ADMIN_KEY,
        );
        await send(
          call,
          'POST',
          '/api/v1/authorizations',
          { provider: 'anthropic', label: 'work\n[ai-gateway] forged line' },
          withAdminKey,
        );
        await send(
          call,
          'POST',
          '/api/v1/authorizations',
          { provider: 'anthropic', account_id: 'account-1' },
          withAdminKey,
        );
        await send(
          call,
          'POST',
          '/api/v1/authorizations/state-1/complete',
          { pasted: 'code-1' },
          withAdminKey,
        );
        await call('/api/v1/authorizations/state-1', { headers: withAdminKey });
        await call('/api/v1/accounts/account-1', {
          method: 'DELETE',
          headers: withAdminKey,
        });

        // Refused: the wrong key, or an account that is not there.
        await call('/api/v1/accounts/account-1', {
          method: 'DELETE',
          headers: withKey,
        });
        await call('/api/v1/accounts/account-1', { method: 'DELETE' });

        expect(info.mock.calls.map(([line]) => line)).toEqual([
          '[ai-gateway] accounts API: started adding an account for anthropic',
          '[ai-gateway] accounts API: started signing account account-1 in again',
          // Finished by a paste, then seen connected by a status read.
          '[ai-gateway] accounts API: connected account account-1',
          '[ai-gateway] accounts API: connected account account-1',
          '[ai-gateway] accounts API: removed account account-1',
        ]);
      } finally {
        info.mockRestore();
      }
    });

    it('does not log an account the gateway could not find', async () => {
      const info = vi
        .spyOn(console, 'info')
        .mockImplementation(() => undefined);
      try {
        const { call } = build(
          { remove: vi.fn(() => Promise.resolve(false)) },
          ADMIN_KEY,
        );
        const response = await call('/api/v1/accounts/not-there\nforged', {
          method: 'DELETE',
          headers: withAdminKey,
        });
        expect(response.status).toBe(404);
        expect(info).not.toHaveBeenCalled();
      } finally {
        info.mockRestore();
      }
    });

    it('removes an account, and 404s one that is gone', async () => {
      const remove = vi
        .fn<AccountService['remove']>()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const { call } = build({ remove }, ADMIN_KEY);
      const first = await call('/api/v1/accounts/account-1', {
        method: 'DELETE',
        headers: withAdminKey,
      });
      expect(first.status).toBe(204);
      expect(first.headers.get('cache-control')).toBe('no-store');
      const second = await call('/api/v1/accounts/account-1', {
        method: 'DELETE',
        headers: withAdminKey,
      });
      expect(second.status).toBe(404);
      expect(remove).toHaveBeenCalledWith('account-1');
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
    expect(at('/api/v1/accounts')).not.toBeNull();
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

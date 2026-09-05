import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetOidcDiscoveryCacheForTests } from '../oidc_discovery';
import type { SsoProviderConfig } from '../types';
import { genericOidcAdapter } from './adapter';

const ISSUER = 'https://idp.example.com';
const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: 'https://idp.example.com/authorize',
  token_endpoint: 'https://idp.example.com/token',
  userinfo_endpoint: 'https://idp.example.com/userinfo',
  jwks_uri: 'https://idp.example.com/jwks',
};

const config: SsoProviderConfig = {
  providerId: 'generic-oidc',
  issuer: ISSUER,
  clientId: 'client-123',
  clientSecret: 'secret-xyz',
  scopes: ['email', 'profile'],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) =>
      handler(urlOf(input), init ?? undefined),
    );
}

afterEach(() => {
  vi.restoreAllMocks();
  resetOidcDiscoveryCacheForTests();
});

describe('generic OIDC adapter (#1506)', () => {
  it('builds the authorize URL from the discovered endpoint and forces the openid scope', async () => {
    mockFetch((url) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const url = await genericOidcAdapter.buildAuthorizeUrl(config, {
      redirectUri: 'https://app.example/callback',
      state: 'state-1',
    });

    expect(`${url.origin}${url.pathname}`).toBe(
      DISCOVERY.authorization_endpoint,
    );
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example/callback',
    );
    expect(url.searchParams.get('state')).toBe('state-1');
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope.split(' ')).toEqual(['openid', 'email', 'profile']);
  });

  it('exchanges the code at the discovered token endpoint', async () => {
    let tokenBody: URLSearchParams | undefined;
    mockFetch((url, init) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      if (url === DISCOVERY.token_endpoint) {
        if (init?.body instanceof URLSearchParams) {
          tokenBody = init.body;
        }
        return jsonResponse({
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 3600,
          id_token: 'idt',
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const tokens = await genericOidcAdapter.exchangeCodeForTokens(config, {
      code: 'auth-code',
      redirectUri: 'https://app.example/callback',
    });

    expect(tokens.accessToken).toBe('at');
    expect(tokens.refreshToken).toBe('rt');
    expect(tokens.idToken).toBe('idt');
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
    expect(tokenBody?.get('grant_type')).toBe('authorization_code');
    expect(tokenBody?.get('code')).toBe('auth-code');
    expect(tokenBody?.get('client_id')).toBe('client-123');
  });

  it('maps userinfo claims (sub -> externalId, email, name, groups)', async () => {
    mockFetch((url) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      if (url === DISCOVERY.userinfo_endpoint) {
        return jsonResponse({
          sub: 'user-1',
          email: 'user@example.com',
          name: 'User One',
          groups: ['admins', 'engineering'],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const info = await genericOidcAdapter.getUserInfo(config, 'at');
    expect(info.externalId).toBe('user-1');
    expect(info.email).toBe('user@example.com');
    expect(info.name).toBe('User One');
    expect(info.groups).toEqual(['admins', 'engineering']);
  });

  it('carries the full userinfo payload on rawClaims for claim-based rules', async () => {
    mockFetch((url) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      return jsonResponse({
        sub: 'user-1',
        email: 'user@example.com',
        realm_access: { roles: ['platform-admin'] },
      });
    });

    const info = await genericOidcAdapter.getUserInfo(config, 'at');
    expect(info.rawClaims).toMatchObject({
      sub: 'user-1',
      realm_access: { roles: ['platform-admin'] },
    });
  });

  it('resolves operator-configured claim mappings (dot-paths) before the standard claims', async () => {
    mockFetch((url) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      return jsonResponse({
        sub: 'user-1',
        email: 'standard@example.com',
        name: 'Standard Name',
        contact: { email: 'mapped@example.com' },
        profile: { displayName: 'Mapped Name' },
        realm_access: { roles: ['admins', 'engineering'] },
      });
    });

    const info = await genericOidcAdapter.getUserInfo(
      {
        ...config,
        claimMappings: {
          email: 'contact.email',
          name: 'profile.displayName',
          groups: 'realm_access.roles',
        },
      },
      'at',
    );
    expect(info.email).toBe('mapped@example.com');
    expect(info.name).toBe('Mapped Name');
    expect(info.groups).toEqual(['admins', 'engineering']);
  });

  it('falls back to the standard claims when a mapped claim is missing', async () => {
    mockFetch((url) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      return jsonResponse({
        sub: 'user-1',
        email: 'standard@example.com',
        name: 'Standard Name',
        groups: ['standard-group'],
      });
    });

    const info = await genericOidcAdapter.getUserInfo(
      {
        ...config,
        claimMappings: { email: 'contact.email', name: 'profile.displayName' },
      },
      'at',
    );
    expect(info.email).toBe('standard@example.com');
    expect(info.name).toBe('Standard Name');
    expect(info.groups).toEqual(['standard-group']);
  });

  it('feeds mapped groups into getGroups for team sync', async () => {
    mockFetch((url) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      return jsonResponse({
        sub: 'user-1',
        email: 'user@example.com',
        realm_access: { roles: ['platform-admins'] },
      });
    });

    const groups = await genericOidcAdapter.getGroups?.(
      { ...config, claimMappings: { groups: 'realm_access.roles' } },
      'at',
    );
    expect(groups).toEqual([
      { id: 'platform-admins', name: 'platform-admins' },
    ]);
  });

  it('falls back to given/family name then preferred_username', async () => {
    mockFetch((url) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      return jsonResponse({
        sub: 'user-2',
        given_name: 'Ada',
        family_name: 'Lovelace',
        preferred_username: 'ada',
      });
    });
    const info = await genericOidcAdapter.getUserInfo(config, 'at');
    expect(info.name).toBe('Ada Lovelace');
    expect(info.email).toBe('ada');
  });

  it('validateConfig succeeds for a discoverable issuer with a userinfo endpoint', async () => {
    mockFetch(() => jsonResponse(DISCOVERY));
    expect(await genericOidcAdapter.validateConfig(config)).toEqual({
      valid: true,
    });
  });

  it('validateConfig fails when discovery is unreachable', async () => {
    mockFetch(() => jsonResponse({}, 404));
    const result = await genericOidcAdapter.validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/discovery/i);
  });

  it('validateConfig fails when no userinfo_endpoint is advertised', async () => {
    mockFetch(() =>
      jsonResponse({ ...DISCOVERY, userinfo_endpoint: undefined }),
    );
    const result = await genericOidcAdapter.validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/userinfo/i);
  });

  it('throws when userinfo omits the required sub claim', async () => {
    mockFetch((url) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      return jsonResponse({ email: 'no-sub@example.com' });
    });
    await expect(genericOidcAdapter.getUserInfo(config, 'at')).rejects.toThrow(
      /sub/i,
    );
  });

  it('advertises PKCE support and puts the S256 challenge on the authorize URL', async () => {
    mockFetch((url) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      throw new Error(`unexpected fetch: ${url}`);
    });

    expect(genericOidcAdapter.capabilities.supportsPkce).toBe(true);

    const url = await genericOidcAdapter.buildAuthorizeUrl(config, {
      redirectUri: 'https://app.example/callback',
      state: 'state-1',
      codeChallenge: 'challenge-abc',
    });
    expect(url.searchParams.get('code_challenge')).toBe('challenge-abc');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('omits PKCE params from the authorize URL without a challenge', async () => {
    mockFetch((url) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const url = await genericOidcAdapter.buildAuthorizeUrl(config, {
      redirectUri: 'https://app.example/callback',
      state: 'state-1',
    });
    expect(url.searchParams.get('code_challenge')).toBeNull();
    expect(url.searchParams.get('code_challenge_method')).toBeNull();
  });

  it('sends the PKCE verifier at the token exchange', async () => {
    let tokenBody: URLSearchParams | undefined;
    mockFetch((url, init) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      if (url === DISCOVERY.token_endpoint) {
        if (init?.body instanceof URLSearchParams) {
          tokenBody = init.body;
        }
        return jsonResponse({ access_token: 'at' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await genericOidcAdapter.exchangeCodeForTokens(config, {
      code: 'auth-code',
      redirectUri: 'https://app.example/callback',
      codeVerifier: 'verifier-xyz',
    });
    expect(tokenBody?.get('code_verifier')).toBe('verifier-xyz');
  });

  it('caches the discovery document across calls in a flow', async () => {
    const fetchSpy = mockFetch((url) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      if (url === DISCOVERY.userinfo_endpoint) {
        return jsonResponse({ sub: 'u', email: 'u@example.com' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await genericOidcAdapter.getUserInfo(config, 'at');
    await genericOidcAdapter.getUserInfo(config, 'at');

    const wellKnownCalls = fetchSpy.mock.calls.filter((call) =>
      urlOf(call[0]).includes('.well-known'),
    ).length;
    expect(wellKnownCalls).toBe(1);
  });
});

describe('generic OIDC adapter — userinfo without an email', () => {
  it('refuses readably instead of passing undefined downstream', async () => {
    // A scope set without `email`, or a userinfo endpoint emitting only
    // `sub`: the old code let `undefined` through and the first
    // `.toLowerCase()` painted a raw TypeError on the login page.
    mockFetch((url) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      return jsonResponse({ sub: 'user-1', name: 'No Mail' });
    });

    await expect(genericOidcAdapter.getUserInfo(config, 'at')).rejects.toThrow(
      /OIDC userinfo response carries no email/,
    );
  });

  it('treats a mistyped email claim mapping the same way', async () => {
    mockFetch((url) => {
      if (url.includes('.well-known')) return jsonResponse(DISCOVERY);
      return jsonResponse({ sub: 'user-1', mail: 'user@example.com' });
    });

    await expect(
      genericOidcAdapter.getUserInfo(
        { ...config, claimMappings: { email: 'contact.mail' } },
        'at',
      ),
    ).rejects.toThrow(/carries no email/);
  });
});

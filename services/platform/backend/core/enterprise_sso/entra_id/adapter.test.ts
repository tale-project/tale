import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SsoGroup, SsoProviderConfig } from '../types';
import { entraIdAdapter } from './adapter';

// `getUserInfo` ignores the config (reads the signed-in user from Graph `/me`),
// so a bare cast is enough to exercise the response mapping.
const fakeConfig = {} as unknown as SsoProviderConfig;

// Optional on the adapter interface; Entra always ships both.
function getGroups(
  config: SsoProviderConfig,
  token: string,
): Promise<SsoGroup[]> {
  const result = entraIdAdapter.getGroups?.(config, token);
  if (result === undefined) {
    throw new Error('the Entra adapter must expose getGroups');
  }
  return result;
}

function getAppRoles(
  config: SsoProviderConfig,
  token: string,
): Promise<string[]> {
  const result = entraIdAdapter.getAppRoles?.(config, token);
  if (result === undefined) {
    throw new Error('the Entra adapter must expose getAppRoles');
  }
  return result;
}

function stubGraphMe(data: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => ({ ok: true, json: async () => data }) as unknown as Response,
    ),
  );
}

describe('entraIdAdapter.getUserInfo — jobTitle normalisation (SSO serverError regression)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps Graph `jobTitle: null` to undefined so a title-less user can sign in', async () => {
    // Microsoft Graph returns `jobTitle: null` for users with no job title;
    // leaking that null tripped `handleSsoLogin`'s `v.optional(v.string())`
    // validator and failed the whole login with a generic serverError.
    stubGraphMe({
      id: 'user-1',
      mail: 'user@example.com',
      displayName: 'User One',
      jobTitle: null,
    });

    const info = await entraIdAdapter.getUserInfo(fakeConfig, 'access-token');

    expect(info.jobTitle).toBeUndefined();
    expect(info.externalId).toBe('user-1');
    expect(info.email).toBe('user@example.com');
  });

  it('preserves a real job title', async () => {
    stubGraphMe({
      id: 'user-2',
      mail: 'eng@example.com',
      displayName: 'Eng Two',
      jobTitle: 'Software Engineer',
    });

    const info = await entraIdAdapter.getUserInfo(fakeConfig, 'access-token');

    expect(info.jobTitle).toBe('Software Engineer');
  });

  it('maps an empty-string job title to undefined', async () => {
    stubGraphMe({
      id: 'user-3',
      mail: 'x@example.com',
      displayName: 'X',
      jobTitle: '',
    });

    const info = await entraIdAdapter.getUserInfo(fakeConfig, 'access-token');

    expect(info.jobTitle).toBeUndefined();
  });
});

/** Serves each page body in order; every extra call answers the last page. */
function stubGraphPages(pages: Record<string, unknown>[]): {
  calls: () => string[];
} {
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      requested.push(String(url));
      const body = pages[Math.min(requested.length, pages.length) - 1];
      return { ok: true, json: async () => body } as unknown as Response;
    }),
  );
  return { calls: () => requested };
}

describe('entraIdAdapter.getGroups — Graph pagination (truncation stripped team memberships)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const group = (id: string): Record<string, unknown> => ({
    '@odata.type': '#microsoft.graph.group',
    id,
    displayName: `Group ${id}`,
  });

  it('follows @odata.nextLink to exhaustion and returns the union of all pages', async () => {
    const { calls } = stubGraphPages([
      {
        value: [
          group('g1'),
          { '@odata.type': '#microsoft.graph.directoryRole', id: 'r1' },
        ],
        '@odata.nextLink':
          'https://graph.microsoft.com/v1.0/me/memberOf?$skiptoken=page2',
      },
      { value: [group('g2'), group('g3')] },
    ]);

    const groups = await getGroups(fakeConfig, 'token');

    // Union of both pages, non-group directory objects filtered out — a
    // 100+-group user keeps every team instead of having page-2+ pruned.
    expect(groups.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
    expect(calls()).toHaveLength(2);
    expect(calls()[1]).toBe(
      'https://graph.microsoft.com/v1.0/me/memberOf?$skiptoken=page2',
    );
  });

  it('reads a single page when no nextLink is present', async () => {
    const { calls } = stubGraphPages([{ value: [group('only')] }]);

    const groups = await getGroups(fakeConfig, 'token');

    expect(groups.map((g) => g.id)).toEqual(['only']);
    expect(calls()).toHaveLength(1);
  });

  it('throws instead of silently truncating when the page cap is exceeded', async () => {
    // A feed that never ends: every response points at another page.
    stubGraphPages([
      {
        value: [group('loop')],
        '@odata.nextLink':
          'https://graph.microsoft.com/v1.0/me/memberOf?$skiptoken=again',
      },
    ]);

    // The callers treat a THROW as "groups unknown" and skip the team-sync
    // prune — a silent partial list would strip memberships instead.
    await expect(getGroups(fakeConfig, 'token')).rejects.toThrow(
      /pagination cap exceeded/,
    );
  });

  it('refuses to follow a nextLink that leaves the Graph origin', async () => {
    stubGraphPages([
      {
        value: [group('g1')],
        '@odata.nextLink': 'https://evil.example.com/steal-token',
      },
    ]);

    await expect(getGroups(fakeConfig, 'token')).rejects.toThrow(
      /refusing to follow/,
    );
  });

  it('propagates a non-OK page as an error (callers skip the prune)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 502,
            json: async () => ({}),
          }) as unknown as Response,
      ),
    );

    await expect(getGroups(fakeConfig, 'token')).rejects.toThrow(
      /Graph API error: 502/,
    );
  });
});

describe('entraIdAdapter.getAppRoles — Graph pagination', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unions appRoleIds across pages', async () => {
    stubGraphPages([
      {
        value: [{ appRoleId: 'role-1' }, { appRoleId: '' }],
        '@odata.nextLink':
          'https://graph.microsoft.com/v1.0/me/appRoleAssignments?$skiptoken=p2',
      },
      { value: [{ appRoleId: 'role-2' }] },
    ]);

    const roles = await getAppRoles(fakeConfig, 'token');

    expect(roles).toEqual(['role-1', 'role-2']);
  });

  it('degrades to no roles on a failed fetch (unchanged contract)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 403,
            json: async () => ({}),
          }) as unknown as Response,
      ),
    );

    const roles = await getAppRoles(fakeConfig, 'token');

    expect(roles).toEqual([]);
  });
});

/**
 * Every call the adapter makes to Microsoft carries an abort signal (the
 * generic OIDC/OAuth2 adapters' fail-fast posture): a stalled token exchange
 * or Graph page must not pin the callback until undici's own timeout, long
 * after the state's 10-minute window has passed.
 */
describe('entraIdAdapter — network calls time out', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubJson(body: Record<string, unknown>): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => body }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function signalsOf(fetchMock: ReturnType<typeof vi.fn>): unknown[] {
    return fetchMock.mock.calls.map((call) => {
      const init: unknown = call[1];
      return init !== null && typeof init === 'object' && 'signal' in init
        ? init.signal
        : undefined;
    });
  }

  const config = {
    providerId: 'entra-id',
    issuer:
      'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0',
    clientId: 'client',
    clientSecret: 'secret',
    scopes: [],
  } as unknown as SsoProviderConfig;

  it('passes an AbortSignal to the token exchange, /me and every Graph page', async () => {
    const fetchMock = stubJson({
      access_token: 'at',
      id: 'user-1',
      mail: 'user@example.com',
      value: [],
    });

    await entraIdAdapter.exchangeCodeForTokens(config, {
      code: 'code',
      redirectUri: 'https://app.example.com/callback',
    });
    await entraIdAdapter.getUserInfo(config, 'token');
    await getGroups(config, 'token');
    await getAppRoles(config, 'token');

    const signals = signalsOf(fetchMock);
    expect(signals).toHaveLength(4);
    for (const signal of signals) {
      expect(signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('passes an AbortSignal to both validateConfig probes', async () => {
    const fetchMock = stubJson({
      token_endpoint:
        'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/token',
      authorization_endpoint:
        'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/authorize',
      access_token: 'probe',
    });

    const result = await entraIdAdapter.validateConfig(config);

    expect(result.valid).toBe(true);
    const signals = signalsOf(fetchMock);
    // Discovery, then the client-credentials probe.
    expect(signals).toHaveLength(2);
    for (const signal of signals) {
      expect(signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe('entraIdAdapter.getUserInfo — email boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to the UPN when `mail` is null', async () => {
    stubGraphMe({
      id: 'user-4',
      mail: null,
      userPrincipalName: 'upn@example.com',
      displayName: 'U',
    });

    const info = await entraIdAdapter.getUserInfo(fakeConfig, 'access-token');

    expect(info.email).toBe('upn@example.com');
  });

  it('refuses readably when Graph returns neither mail nor a UPN', async () => {
    stubGraphMe({ id: 'user-5', mail: null, displayName: 'Ghost' });

    await expect(
      entraIdAdapter.getUserInfo(fakeConfig, 'access-token'),
    ).rejects.toThrow(/Microsoft Graph \/me response carries no email/);
  });
});

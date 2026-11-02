import { generateKeyPairSync } from 'node:crypto';

import { decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../http_connectors/token_exchange.ts';
import {
  buildGithubAppManifest,
  convertManifestCode,
  getInstallation,
  githubAppInstallUrl,
  githubAppRegistrationUrl,
  listAppInstallations,
  listInstallationRepositories,
  mintInstallationToken,
  narrowPermissions,
  signGithubAppJwt,
} from './github_app.ts';

const PERMISSIONS = {
  metadata: 'read',
  contents: 'write',
  issues: 'write',
  pull_requests: 'write',
} as const;

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

interface Recorded {
  url: string;
  init: RequestInit;
}

/** A fetch that answers every call with `status` and `body`, and keeps what
 * it was asked. */
function stubFetch(
  status: number,
  body: unknown,
): { fetchImpl: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return new Headers(init.headers).get(name) ?? undefined;
}

/** The JSON a call sent: every body these calls send is JSON text. */
function jsonBodyOf(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== 'string') {
    throw new Error(`The call sent no JSON text, but ${typeof body}`);
  }
  return JSON.parse(body);
}

describe('the app manifest', () => {
  const base = {
    name: 'Tale Acme',
    redirectUrl:
      'https://tale.example.com/api/connectors/github-app/registered',
    setupUrl: 'https://tale.example.com/api/connectors/github-app/installed',
    permissions: PERMISSIONS,
  };

  it('[CONN-R34] asks for exactly the connector’s permissions, with the webhook off', () => {
    const manifest = buildGithubAppManifest({
      ...base,
      baseUrl: 'https://tale.example.com',
    });
    expect(manifest.default_permissions).toStrictEqual(PERMISSIONS);
    expect(manifest.hook_attributes).toStrictEqual({
      url: 'https://tale.example.com',
      active: false,
    });
    expect(manifest).not.toHaveProperty('default_events');
    expect(manifest.public).toBe(false);
    expect(manifest.request_oauth_on_install).toBe(false);
    expect(manifest.redirect_url).toBe(base.redirectUrl);
    expect(manifest.setup_url).toBe(base.setupUrl);
  });

  it('[CONN-R34] leaves the hook out for a Tale on a loopback address, which GitHub refuses', () => {
    for (const baseUrl of [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://tale.localhost',
    ]) {
      const manifest = buildGithubAppManifest({ ...base, baseUrl });
      expect(manifest).not.toHaveProperty('hook_attributes');
      expect(manifest).not.toHaveProperty('default_events');
      expect(manifest.default_permissions).toStrictEqual(PERMISSIONS);
    }
  });

  it('posts to the account’s own settings, or to the organization it names', () => {
    expect(githubAppRegistrationUrl('s t')).toBe(
      'https://github.com/settings/apps/new?state=s%20t',
    );
    expect(githubAppRegistrationUrl('abc', 'acme-inc')).toBe(
      'https://github.com/organizations/acme-inc/settings/apps/new?state=abc',
    );
    expect(githubAppInstallUrl('tale-acme', 'abc')).toBe(
      'https://github.com/apps/tale-acme/installations/new?state=abc',
    );
  });
});

describe('the app’s JWT', () => {
  it('[CCRED-R17] is RS256, issued by the client ID a minute back, and expires within ten minutes', async () => {
    const nowMs = Date.UTC(2026, 10, 2, 9, 0, 0);
    const jwt = await signGithubAppJwt({
      clientId: 'Iv23liExample',
      privateKey,
      nowMs,
    });
    expect(decodeProtectedHeader(jwt)).toStrictEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const { payload } = await jwtVerify(
      jwt,
      (await import('node:crypto')).createPublicKey(publicKey),
      { currentDate: new Date(nowMs) },
    );
    const now = nowMs / 1000;
    expect(payload.iss).toBe('Iv23liExample');
    expect(payload.iat).toBe(now - 60);
    expect(payload.exp).toBeGreaterThan(now);
    expect(payload.exp! - now).toBeLessThanOrEqual(600);
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(600);
  });
});

describe('minting an installation token', () => {
  it('[CCRED-R16] asks for the narrowed permissions and the named repositories only', async () => {
    const { fetchImpl, calls } = stubFetch(201, {
      token: 'ghs_example',
      expires_at: '2026-11-02T10:00:00Z',
      permissions: { contents: 'write', metadata: 'read' },
      repository_selection: 'selected',
      repositories: [{ full_name: 'acme/site' }],
    });
    const minted = await mintInstallationToken(
      {
        jwt: 'jwt.example',
        installationId: 42,
        permissions: { contents: 'write', metadata: 'read' },
        repositories: ['site'],
      },
      fetchImpl,
    );
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(
      'https://api.github.com/app/installations/42/access_tokens',
    );
    expect(call?.init.method).toBe('POST');
    expect(headerOf(call!.init, 'authorization')).toBe('Bearer jwt.example');
    expect(jsonBodyOf(call?.init)).toStrictEqual({
      permissions: { contents: 'write', metadata: 'read' },
      repositories: ['site'],
    });
    expect(minted).toStrictEqual({
      ok: true,
      value: {
        token: 'ghs_example',
        expiresAt: Date.parse('2026-11-02T10:00:00Z'),
        permissions: { contents: 'write', metadata: 'read' },
        repositorySelection: 'selected',
        repositories: ['acme/site'],
      },
    });
  });

  it('[CCRED-R16] names no repositories when none are asked for', async () => {
    const { fetchImpl, calls } = stubFetch(201, {
      token: 'ghs_example',
      expires_at: '2026-11-02T10:00:00Z',
      repository_selection: 'all',
    });
    await mintInstallationToken(
      { jwt: 'j', installationId: 7, permissions: { issues: 'write' } },
      fetchImpl,
    );
    expect(jsonBodyOf(calls[0]?.init)).toStrictEqual({
      permissions: { issues: 'write' },
    });
  });

  it('[CCRED-R16] narrows to what the installation grants, and never widens', () => {
    expect(
      narrowPermissions(
        {
          contents: 'write',
          issues: 'write',
          metadata: 'read',
          checks: 'read',
        },
        {
          contents: 'read',
          issues: 'write',
          metadata: 'read',
          admin_x: 'write',
        },
      ),
    ).toStrictEqual({ contents: 'read', issues: 'write', metadata: 'read' });
    expect(
      narrowPermissions({ metadata: 'read' }, { metadata: 'write' }),
    ).toStrictEqual({ metadata: 'read' });
    expect(narrowPermissions({ contents: 'write' }, {})).toStrictEqual({});
  });

  it('maps GitHub’s refusals onto reasons a caller can act on', async () => {
    const cases = [
      [404, 'not_found'],
      [422, 'rejected'],
      [401, 'rejected'],
      [503, 'unreachable'],
      [429, 'unreachable'],
    ] as const;
    for (const [status, reason] of cases) {
      const { fetchImpl } = stubFetch(status, { message: `status ${status}` });
      const minted = await mintInstallationToken(
        { jwt: 'j', installationId: 1, permissions: { metadata: 'read' } },
        fetchImpl,
      );
      expect(minted).toStrictEqual({
        ok: false,
        reason,
        status,
        message: `status ${status}`,
      });
    }
    const unreachable = await mintInstallationToken(
      { jwt: 'j', installationId: 1, permissions: { metadata: 'read' } },
      async () => {
        throw new TypeError('fetch failed');
      },
    );
    expect(unreachable).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('refuses a success without an expiry it can read', async () => {
    const { fetchImpl } = stubFetch(201, {
      token: 'ghs_example',
      expires_at: 'soon',
      repository_selection: 'all',
    });
    expect(
      await mintInstallationToken(
        { jwt: 'j', installationId: 1, permissions: { metadata: 'read' } },
        fetchImpl,
      ),
    ).toMatchObject({ ok: false, reason: 'malformed' });
  });
});

describe('the registration and the installation', () => {
  it('[CCRED-R15] keeps the private key and drops the client and webhook secrets', async () => {
    const { fetchImpl, calls } = stubFetch(201, {
      id: 123,
      slug: 'tale-acme',
      name: 'Tale Acme',
      client_id: 'Iv23liExample',
      client_secret: 'secret-never-kept',
      webhook_secret: null,
      pem: privateKey,
      owner: { login: 'acme-inc' },
      html_url: 'https://github.com/apps/tale-acme',
      permissions: PERMISSIONS,
    });
    const registered = await convertManifestCode('code 1', fetchImpl);
    expect(calls[0]?.url).toBe(
      'https://api.github.com/app-manifests/code%201/conversions',
    );
    expect(calls[0]?.init.method).toBe('POST');
    expect(headerOf(calls[0]!.init, 'authorization')).toBeUndefined();
    expect(registered).toStrictEqual({
      ok: true,
      value: {
        appId: 123,
        slug: 'tale-acme',
        name: 'Tale Acme',
        clientId: 'Iv23liExample',
        privateKey,
        owner: 'acme-inc',
        htmlUrl: 'https://github.com/apps/tale-acme',
        permissions: PERMISSIONS,
      },
    });
    expect(JSON.stringify(registered)).not.toContain('secret-never-kept');
  });

  it('reads an installation with the app’s JWT', async () => {
    const { fetchImpl, calls } = stubFetch(200, {
      id: 42,
      app_id: 123,
      account: { login: 'acme-inc', type: 'Organization' },
      repository_selection: 'selected',
      permissions: { contents: 'write', metadata: 'read' },
      suspended_at: null,
    });
    const installation = await getInstallation('jwt.example', 42, fetchImpl);
    expect(calls[0]?.url).toBe('https://api.github.com/app/installations/42');
    expect(headerOf(calls[0]!.init, 'authorization')).toBe(
      'Bearer jwt.example',
    );
    expect(installation).toStrictEqual({
      ok: true,
      value: {
        id: 42,
        appId: 123,
        account: 'acme-inc',
        accountType: 'Organization',
        repositorySelection: 'selected',
        permissions: { contents: 'write', metadata: 'read' },
        suspended: false,
      },
    });
  });

  it('[CONN-R37] lists the app’s installations with its JWT', async () => {
    const { fetchImpl, calls } = stubFetch(200, [
      {
        id: 42,
        app_id: 123,
        account: { login: 'acme-inc', type: 'Organization' },
        repository_selection: 'all',
        suspended_at: '2026-11-01T08:00:00Z',
      },
    ]);
    const listed = await listAppInstallations('jwt.example', fetchImpl);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://api.github.com/app/installations?per_page=100',
    );
    expect(calls[0]?.init.method).toBe('GET');
    expect(headerOf(calls[0]!.init, 'authorization')).toBe(
      'Bearer jwt.example',
    );
    expect(listed).toStrictEqual({
      ok: true,
      value: [
        {
          id: 42,
          appId: 123,
          account: 'acme-inc',
          accountType: 'Organization',
          repositorySelection: 'all',
          permissions: {},
          suspended: true,
        },
      ],
    });
    expect(
      await listAppInstallations('jwt.example', stubFetch(200, []).fetchImpl),
    ).toStrictEqual({ ok: true, value: [] });
  });

  it('[CONN-R37] refuses an installation list it cannot read, as it refuses any answer', async () => {
    for (const body of [
      { id: 42 },
      [{ id: 42, app_id: 123, repository_selection: 'all' }],
    ]) {
      expect(
        await listAppInstallations('j', stubFetch(200, body).fetchImpl),
      ).toStrictEqual({
        ok: false,
        reason: 'malformed',
        message: 'GitHub answered without the installation list',
      });
    }
    const cases = [
      [401, 'rejected'],
      [403, 'rejected'],
      [404, 'not_found'],
      [503, 'unreachable'],
      [429, 'unreachable'],
    ] as const;
    for (const [status, reason] of cases) {
      const { fetchImpl } = stubFetch(status, { message: `status ${status}` });
      expect(await listAppInstallations('j', fetchImpl)).toStrictEqual({
        ok: false,
        reason,
        status,
        message: `status ${status}`,
      });
    }
    expect(
      await listAppInstallations('j', async () => {
        throw new TypeError('fetch failed');
      }),
    ).toStrictEqual({
      ok: false,
      reason: 'unreachable',
      message: 'GitHub could not be reached (TypeError)',
    });
  });

  it('lists the repositories an installation token reaches', async () => {
    const { fetchImpl, calls } = stubFetch(200, {
      total_count: 1,
      repository_selection: 'selected',
      repositories: [
        {
          full_name: 'acme-inc/site',
          private: true,
          html_url: 'https://github.com/acme-inc/site',
        },
      ],
    });
    const listed = await listInstallationRepositories('ghs_example', fetchImpl);
    expect(calls[0]?.url).toBe(
      'https://api.github.com/installation/repositories?per_page=100',
    );
    expect(listed).toStrictEqual({
      ok: true,
      value: {
        totalCount: 1,
        repositories: [
          {
            fullName: 'acme-inc/site',
            private: true,
            htmlUrl: 'https://github.com/acme-inc/site',
          },
        ],
      },
    });
  });
});

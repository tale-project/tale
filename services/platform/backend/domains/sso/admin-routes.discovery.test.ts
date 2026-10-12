import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { MAX_FILE_SIZE_BYTES } from '../../core/enterprise_sso/file_utils.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { createSsoAdminRoutes } from './admin-routes.ts';
import { getSsoConnectionView } from './admin.ts';
import {
  getSsoDiscoveryStatus,
  listSelectableSsoConnections,
  readSsoConnection,
  resolveProvisioning,
  resolveSamlConfig,
  resolveSignInConfig,
  SsoConnectionReadError,
} from './config.ts';

/**
 * `GET /api/app/sso/discovery/trusted-headers` — the login page's question
 * "did this request come through an authenticating proxy?". Presence only:
 * the door validates the key; this route touches neither the database nor
 * a session, so the router is built on inert dependencies.
 */

const app = createSsoAdminRoutes({
  sql: {} as unknown as Sql,
  auth: {} as unknown as Auth,
});

async function probe(headers: Record<string, string> = {}) {
  const res = await app.request('/discovery/trusted-headers', { headers });
  return {
    status: res.status,
    body: (await res.json()) as { handoff: boolean },
    cache: res.headers.get('cache-control'),
  };
}

describe('GET /discovery/trusted-headers — is a proxy hand-off on this request', () => {
  it('answers no for a plain browser request, and never caches', async () => {
    const answer = await probe();
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ handoff: false });
    expect(answer.cache).toBe('no-store');
  });

  it('answers yes when the key rides in the key header', async () => {
    expect(
      (await probe({ 'remote-internal-secret': 'thk_0123456789abcdef' })).body,
    ).toEqual({ handoff: true });
  });

  it('ignores an Authorization header — the key has one slot, and the REST API key is not it', async () => {
    expect(
      (await probe({ authorization: 'Bearer thk_0123456789abcdef' })).body,
    ).toEqual({ handoff: false });
  });

  it("answers yes on the proxy's identity header alone — the key may ride on the door only", async () => {
    expect(
      (await probe({ 'remote-email': 'member@example.com' })).body,
    ).toEqual({ handoff: true });
  });

  it('reads an empty identity header as absent', async () => {
    expect((await probe({ 'remote-email': '   ' })).body).toEqual({
      handoff: false,
    });
  });
});

describe('SSO discovery isolates unreadable tenant connections [SSO-R18]', () => {
  type Org = { id: string; slug: string };
  let configRoot: string;
  let savedConfigDir: string | undefined;
  let orgs: Org[];

  beforeEach(async () => {
    savedConfigDir = process.env.TALE_CONFIG_DIR;
    configRoot = await mkdtemp(path.join(tmpdir(), 'tale-sso-discovery-'));
    process.env.TALE_CONFIG_DIR = configRoot;
    orgs = [];
    clearOrgConfigCaches();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (savedConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
    else process.env.TALE_CONFIG_DIR = savedConfigDir;
    await rm(configRoot, { recursive: true, force: true });
    clearOrgConfigCaches();
    vi.restoreAllMocks();
  });

  function addOrg(slug: string): Org {
    const org = { id: `org-${slug}`, slug };
    orgs.push(org);
    return org;
  }

  /** Only organization and SCIM reads are answered; no real database or
   * session is involved. A foreign slug lookup can throw inside the reader
   * to prove the discovery catch does not swallow SQL/permission failures. */
  function sqlFor(lookupFailure?: { org: Org; error: unknown }): Sql {
    const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join('$?');
      if (query.includes('SELECT "slug" FROM "organization"')) {
        if (lookupFailure && values[0] === lookupFailure.org.id)
          throw lookupFailure.error;
        const org = orgs.find(({ id }) => id === values[0]);
        return org ? [{ slug: org.slug }] : [];
      }
      if (query.includes('SELECT "id" FROM "organization"'))
        return orgs
          .filter(({ id }) => !query.includes('"id" <>') || id !== values[0])
          .map(({ id }) => ({ id }));
      if (query.includes('FROM app.sso_connections')) return [];
      throw new Error(`unexpected SSO fixture query: ${query}`);
    };
    return tag as unknown as Sql;
  }

  async function dirFor(org: Org): Promise<string> {
    const dir = path.join(configRoot, org.slug, 'governance', 'sso');
    await mkdir(dir, { recursive: true });
    return dir;
  }

  function connection(protocol: 'oidc' | 'saml' = 'oidc') {
    return {
      enabled: true,
      displayName: 'Healthy SSO',
      protocol,
      ...(protocol === 'oidc'
        ? {
            oidc: {
              providerId: 'generic-oidc',
              issuer: 'https://idp.example/healthy',
              scopes: ['openid'],
            },
          }
        : {
            saml: {
              idpEntityId: 'https://idp.example/entity',
              idpSsoUrl: 'https://idp.example/login',
              idpCertificate: 'fixture-public-certificate',
            },
          }),
    };
  }

  async function store(
    org: Org,
    value: object,
    filename = 'connection.yml',
  ): Promise<void> {
    await writeFile(
      path.join(await dirFor(org), filename),
      JSON.stringify(value),
    );
  }

  const failures = [
    'unreadable',
    'oversized',
    'malformed',
    'invalid schema',
  ] as const;

  async function breakConnection(org: Org, failure: (typeof failures)[number]) {
    const file = path.join(await dirFor(org), 'connection.yml');
    if (failure === 'unreadable') await mkdir(file);
    else
      await writeFile(
        file,
        failure === 'oversized'
          ? '#'.repeat(MAX_FILE_SIZE_BYTES + 1)
          : failure === 'malformed'
            ? 'protocol: [saml\n'
            : 'enabled: not-a-boolean\n',
      );
  }

  async function discovery(sql: Sql, route: 'configured' | 'selectable') {
    const router = createSsoAdminRoutes({ sql, auth: {} as Auth });
    const response = await router.request(`/discovery/${route}`);
    expect(response.status).toBe(200);
    return response.json();
  }

  for (const failure of failures) {
    it(`configured discovery keeps a healthy tenant beside ${failure} configuration`, async () => {
      const broken = addOrg('broken');
      await breakConnection(broken, failure);
      await store(addOrg('healthy'), connection());

      expect(await discovery(sqlFor(), 'configured')).toEqual({
        enabled: true,
        providerType: 'generic-oidc',
        seamlessSsoEnabled: false,
        multiple: false,
      });
      expect(console.error).toHaveBeenCalledWith(
        '[sso] connection configuration unreadable',
        expect.objectContaining({ orgSlug: broken.slug }),
      );
    });

    it(`selectable discovery offers only the healthy tenant beside ${failure} configuration`, async () => {
      await breakConnection(addOrg('broken'), failure);
      const healthy = addOrg('healthy');
      await store(healthy, connection());

      expect(await discovery(sqlFor(), 'selectable')).toEqual({
        connections: [
          {
            organizationId: healthy.id,
            displayName: 'Healthy SSO',
            protocol: 'oidc',
          },
        ],
      });
    });

    it(`implicit sign-in finds the sole healthy tenant beside ${failure} configuration`, async () => {
      await breakConnection(addOrg('broken'), failure);
      const healthy = addOrg('healthy');
      await store(healthy, connection());

      await expect(
        resolveSignInConfig(sqlFor(), undefined),
      ).resolves.toMatchObject({
        organizationId: healthy.id,
        issuer: 'https://idp.example/healthy',
      });
    });

    it(`healthy settings isolate a foreign tenant's ${failure} configuration`, async () => {
      await breakConnection(addOrg('broken'), failure);
      const healthy = addOrg('healthy');
      await store(healthy, connection());

      await expect(
        getSsoConnectionView(sqlFor(), healthy.id),
      ).resolves.toMatchObject({
        configured: true,
        otherOrgsEnabled: false,
      });
    });

    it(`an explicit ${failure} tenant still refuses its own configuration despite a healthy tenant`, async () => {
      const broken = addOrg('broken');
      await breakConnection(broken, failure);
      await store(addOrg('healthy'), connection());
      const sql = sqlFor();

      for (const read of [
        readSsoConnection,
        resolveSignInConfig,
        resolveSamlConfig,
        resolveProvisioning,
      ])
        await expect(read(sql, broken.id)).rejects.toBeInstanceOf(
          SsoConnectionReadError,
        );
      await expect(getSsoConnectionView(sql, broken.id)).rejects.toMatchObject({
        code: 'sso_config_unreadable',
        status: 409,
        message: expect.stringContaining('repair connection.yml'),
      });
    });
  }

  it('ignores a superseded JSON sibling when the authoritative YAML is broken', async () => {
    const broken = addOrg('broken');
    await breakConnection(broken, 'malformed');
    await store(broken, connection(), 'connection.json');
    const healthy = addOrg('healthy');
    await store(healthy, connection(), 'connection.json');
    const sql = sqlFor();

    expect(await listSelectableSsoConnections(sql)).toEqual([
      {
        organizationId: healthy.id,
        displayName: 'Healthy SSO',
        protocol: 'oidc',
      },
    ]);
    await expect(readSsoConnection(sql, broken.id)).rejects.toBeInstanceOf(
      SsoConnectionReadError,
    );
  });

  it('keeps the healthy SAML connection even when a broken tenant follows it', async () => {
    const healthy = addOrg('healthy');
    await store(healthy, connection('saml'));
    await breakConnection(addOrg('broken'), 'malformed');
    const sql = sqlFor();

    await expect(getSsoDiscoveryStatus(sql)).resolves.toMatchObject({
      enabled: true,
      providerType: 'saml',
      multiple: false,
    });
    await expect(resolveSamlConfig(sql, undefined)).resolves.toMatchObject({
      organizationId: healthy.id,
      idpSsoUrl: 'https://idp.example/login',
    });
  });

  it('answers unconfigured when all present tenant connections are unreadable', async () => {
    for (const failure of failures)
      await breakConnection(addOrg(failure.replaceAll(' ', '-')), failure);
    const sql = sqlFor();

    expect(await discovery(sql, 'configured')).toEqual({ enabled: false });
    expect(await discovery(sql, 'selectable')).toEqual({ connections: [] });
    await expect(resolveSignInConfig(sql, undefined)).resolves.toBeNull();
    await expect(resolveSamlConfig(sql, undefined)).resolves.toBeNull();
  });

  it('keeps disabled and absent tenants out of discovery', async () => {
    addOrg('absent');
    await store(addOrg('disabled'), { ...connection(), enabled: false });
    const sql = sqlFor();

    expect(await discovery(sql, 'configured')).toEqual({ enabled: false });
    expect(await discovery(sql, 'selectable')).toEqual({ connections: [] });
    await expect(resolveSignInConfig(sql, undefined)).resolves.toBeNull();
  });

  it('preserves multiple-healthy ambiguity and the settings warning after skipping a broken tenant', async () => {
    await breakConnection(addOrg('broken'), 'malformed');
    const healthy = addOrg('healthy');
    await store(healthy, connection());
    const second = addOrg('second');
    await store(second, connection('saml'));
    const sql = sqlFor();

    expect(await discovery(sql, 'configured')).toMatchObject({
      enabled: true,
      multiple: true,
    });
    expect(await discovery(sql, 'selectable')).toEqual({
      connections: [
        {
          organizationId: healthy.id,
          displayName: 'Healthy SSO',
          protocol: 'oidc',
        },
        {
          organizationId: second.id,
          displayName: 'Healthy SSO',
          protocol: 'saml',
        },
      ],
    });
    await expect(resolveSignInConfig(sql, undefined)).resolves.toBe(
      'ambiguous',
    );
    await expect(resolveSamlConfig(sql, undefined)).resolves.toBe('ambiguous');
    await expect(getSsoConnectionView(sql, healthy.id)).resolves.toMatchObject({
      otherOrgsEnabled: true,
    });
  });

  it('keeps the twenty-choice cap without charging an unreadable tenant against it', async () => {
    await breakConnection(addOrg('broken'), 'malformed');
    const healthy: Org[] = [];
    for (let i = 0; i < 21; i++) {
      const org = addOrg(`healthy-${i}`);
      healthy.push(org);
      await store(org, connection());
    }

    expect(await discovery(sqlFor(), 'selectable')).toEqual({
      connections: healthy.slice(0, 20).map(({ id }) => ({
        organizationId: id,
        displayName: 'Healthy SSO',
        protocol: 'oidc',
      })),
    });
  });

  it.each([
    [
      'SQL permission failure',
      Object.assign(new Error('permission denied'), { code: '42501' }),
    ],
    [
      'lookalike name',
      Object.assign(new Error('unexpected lookup failure'), {
        name: 'SsoConnectionReadError',
      }),
    ],
    ['non-error refusal', { unavailable: true }],
  ])(
    'propagates a foreign tenant lookup %s unchanged',
    async (_label, error) => {
      const foreign = addOrg('foreign');
      const healthy = addOrg('healthy');
      await store(healthy, connection());
      const sql = sqlFor({ org: foreign, error });

      await expect(getSsoDiscoveryStatus(sql)).rejects.toBe(error);
      await expect(listSelectableSsoConnections(sql)).rejects.toBe(error);
      await expect(resolveSignInConfig(sql, undefined)).rejects.toBe(error);
      await expect(getSsoConnectionView(sql, healthy.id)).rejects.toBe(error);
    },
  );

  it('does not turn a missing deployment configuration root into absent tenant connections', async () => {
    addOrg('healthy');
    delete process.env.TALE_CONFIG_DIR;
    const sql = sqlFor();

    await expect(getSsoDiscoveryStatus(sql)).rejects.toThrow('TALE_CONFIG_DIR');
    await expect(listSelectableSsoConnections(sql)).rejects.toThrow(
      'TALE_CONFIG_DIR',
    );
    await expect(resolveSignInConfig(sql, undefined)).rejects.toThrow(
      'TALE_CONFIG_DIR',
    );
  });
});

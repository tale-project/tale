// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SsoProviderAdapter } from '../../core/enterprise_sso/types.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { SsoAdminError, testSsoConnection, upsertSamlConnection } from './admin.ts';

/** The adapter under "Test connection": records what it was asked to probe. */
const { validateConfig } = vi.hoisted(() => ({
  validateConfig: vi.fn().mockResolvedValue({ valid: true }),
}));

// The save's audit row needs a real chain head; the write itself is not what
// these cases pin.
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../core/enterprise_sso/registry.ts', () => ({
  getAdapter: (providerId: string): SsoProviderAdapter | null =>
    providerId === 'entra-id'
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only validateConfig is exercised
        ({ providerId, validateConfig } as unknown as SsoProviderAdapter)
      : null,
}));

/** Sql double answering the org-slug lookup; `begin` runs the audit write
 * against the same double, so a save can complete without a database. */
function slugSql(slug: string): Sql {
  const tag = (strings: TemplateStringsArray) =>
    Promise.resolve(
      strings.join('$?').includes('SELECT "slug" FROM "organization"')
        ? [{ slug }]
        : [],
    );
  Object.assign(tag, {
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(tag),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return tag as unknown as Sql;
}

const probe = {
  providerId: 'entra-id' as const,
  issuer: 'https://login.microsoftonline.com/tenant/v2.0',
  clientId: 'client-1',
  scopes: ['openid'],
};

/**
 * "Test connection" probes the credentials that will sign users in: the
 * secret the admin just typed, or the stored one when the field is blank
 * (reuse-on-omit, the save's own contract). The Entra adapter's
 * client-credentials probe — which maps a wrong or expired secret to a
 * readable reason — used to be unreachable because nothing ever handed the
 * test a secret, so a bad secret passed the test and failed at sign-in.
 */
describe('testSsoConnection — the client secret reaches the adapter', () => {
  let configRoot: string;
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    savedConfigDir = process.env.TALE_CONFIG_DIR;
    configRoot = await mkdtemp(path.join(tmpdir(), 'tale-sso-admin-'));
    process.env.TALE_CONFIG_DIR = configRoot;
    clearOrgConfigCaches();
    validateConfig.mockClear();
  });

  afterEach(async () => {
    if (savedConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
    else process.env.TALE_CONFIG_DIR = savedConfigDir;
    await rm(configRoot, { recursive: true, force: true });
    clearOrgConfigCaches();
  });

  async function storeSecrets(slug: string, secrets: object): Promise<void> {
    const dir = path.join(configRoot, slug, 'governance', 'sso');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'connection.secrets.json'),
      JSON.stringify(secrets),
    );
  }

  it('probes with the secret the admin typed', async () => {
    await storeSecrets('acme', { clientId: 'client-1', clientSecret: 'old' });

    await testSsoConnection(slugSql('acme'), 'org-1', {
      ...probe,
      clientSecret: 'freshly-typed',
    });

    expect(validateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: 'freshly-typed' }),
    );
  });

  it('falls back to the stored secret when the field is left blank', async () => {
    await storeSecrets('acme', { clientId: 'client-1', clientSecret: 'stored' });

    await testSsoConnection(slugSql('acme'), 'org-1', {
      ...probe,
      clientSecret: '',
    });

    expect(validateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: 'stored' }),
    );
  });

  it('probes discovery alone when no secret is typed or stored', async () => {
    await testSsoConnection(slugSql('acme'), 'org-1', probe);

    expect(validateConfig).toHaveBeenCalledTimes(1);
    expect(validateConfig.mock.calls[0]?.[0]).not.toHaveProperty(
      'clientSecret',
    );
  });

  it('refuses an unknown provider before reading anything', async () => {
    const result = await testSsoConnection(slugSql('acme'), 'org-1', {
      ...probe,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberately outside the enum
      providerId: 'nope' as 'entra-id',
    });

    expect(result).toEqual({ valid: false, error: 'Unknown provider' });
    expect(validateConfig).not.toHaveBeenCalled();
  });
});

/**
 * A SAML connection that requires encrypted assertions but holds no SP
 * private key would refuse every login (node-saml cannot decrypt) — the save
 * is refused instead, under a stable code the form pins to the key field.
 * The key is a secret reused-on-omit, so a stored one satisfies the toggle.
 */
describe('upsertSamlConnection — encryption needs the key that decrypts', () => {
  let configRoot: string;
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    savedConfigDir = process.env.TALE_CONFIG_DIR;
    configRoot = await mkdtemp(path.join(tmpdir(), 'tale-sso-admin-'));
    process.env.TALE_CONFIG_DIR = configRoot;
    clearOrgConfigCaches();
  });

  afterEach(async () => {
    if (savedConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
    else process.env.TALE_CONFIG_DIR = savedConfigDir;
    await rm(configRoot, { recursive: true, force: true });
    clearOrgConfigCaches();
  });

  const actor = { userId: 'user-1', email: 'admin@acme.test', role: 'admin' };
  const saml = {
    displayName: 'Acme SAML',
    idpEntityId: 'https://idp.acme.test/entity',
    idpSsoUrl: 'https://idp.acme.test/sso',
    idpCertificate: '-----BEGIN CERTIFICATE-----\nIDP\n-----END CERTIFICATE-----',
    autoProvisionRole: false,
    defaultRole: 'member' as const,
    roleMappingRules: [],
    autoProvisionTeam: false,
    excludeGroups: [],
  };

  it('refuses to require encrypted assertions without any SP private key', async () => {
    const attempt = upsertSamlConnection(slugSql('acme'), 'org-1', actor, {
      ...saml,
      spCertificate: '-----BEGIN CERTIFICATE-----\nSP\n-----END CERTIFICATE-----',
      wantAssertionsEncrypted: true,
    });

    await expect(attempt).rejects.toBeInstanceOf(SsoAdminError);
    await expect(attempt).rejects.toMatchObject({
      code: 'sso_sp_key_required',
      status: 400,
    });
  });

  it('accepts the toggle with a key typed in the same save', async () => {
    await expect(
      upsertSamlConnection(slugSql('acme'), 'org-1', actor, {
        ...saml,
        spCertificate: '-----BEGIN CERTIFICATE-----\nSP\n-----END CERTIFICATE-----',
        spPrivateKey: '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----',
        wantAssertionsEncrypted: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('accepts the toggle when the key is already stored (reuse-on-omit)', async () => {
    const dir = path.join(configRoot, 'acme', 'governance', 'sso');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'connection.secrets.json'),
      JSON.stringify({ spPrivateKey: 'stored-key' }),
    );

    await expect(
      upsertSamlConnection(slugSql('acme'), 'org-1', actor, {
        ...saml,
        spCertificate: '-----BEGIN CERTIFICATE-----\nSP\n-----END CERTIFICATE-----',
        wantAssertionsEncrypted: true,
      }),
    ).resolves.toBeUndefined();
  });
});

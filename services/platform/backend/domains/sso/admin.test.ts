// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readExisting } from '../../core/enterprise_sso/config/file_store.ts';
import type { SsoProviderAdapter } from '../../core/enterprise_sso/types.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import type { CreateAuditLogArgs } from '../audit_logs/types.ts';
import {
  getSsoConnectionView,
  setSsoProvisioning,
  SsoAdminError,
  testSsoConnection,
  upsertOidcConnection,
  upsertSamlConnection,
} from './admin.ts';
import { resolveSignInConfig } from './config.ts';

/** The adapter under "Test connection": records what it was asked to probe. */
const { validateConfig } = vi.hoisted(() => ({
  validateConfig: vi.fn().mockResolvedValue({ valid: true }),
}));

// The save's audit row needs a real database; the write itself is not what
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

/** A `connection.yml` no reader can parse — the operator-repair case. */
async function corruptConnectionFile(
  configRoot: string,
  slug: string,
): Promise<string> {
  const dir = path.join(configRoot, slug, 'governance', 'sso');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'connection.yml');
  await writeFile(file, 'protocol: [saml\n');
  return file;
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
    await storeSecrets('acme', {
      clientId: 'client-1',
      clientSecret: 'stored',
    });

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

  it('probes with the typed secret without consulting a corrupt connection file', async () => {
    await corruptConnectionFile(configRoot, 'acme');

    await testSsoConnection(slugSql('acme'), 'org-1', {
      ...probe,
      clientSecret: 'freshly-typed',
    });

    expect(validateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: 'freshly-typed' }),
    );
  });

  it('refuses readably when the stored secret is needed but the file is corrupt', async () => {
    await corruptConnectionFile(configRoot, 'acme');

    const attempt = testSsoConnection(slugSql('acme'), 'org-1', probe);

    await expect(attempt).rejects.toBeInstanceOf(SsoAdminError);
    await expect(attempt).rejects.toMatchObject({
      code: 'sso_config_unreadable',
      status: 409,
    });
    expect(validateConfig).not.toHaveBeenCalled();
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
    idpCertificate:
      '-----BEGIN CERTIFICATE-----\nIDP\n-----END CERTIFICATE-----',
    autoProvisionRole: false,
    defaultRole: 'member' as const,
    roleMappingRules: [],
    autoProvisionTeam: false,
    excludeGroups: [],
  };

  it('refuses to require encrypted assertions without any SP private key [SSO-R16]', async () => {
    const attempt = upsertSamlConnection(slugSql('acme'), 'org-1', actor, {
      ...saml,
      spCertificate:
        '-----BEGIN CERTIFICATE-----\nSP\n-----END CERTIFICATE-----',
      wantAssertionsEncrypted: true,
    });

    await expect(attempt).rejects.toBeInstanceOf(SsoAdminError);
    await expect(attempt).rejects.toMatchObject({
      code: 'sso_sp_key_required',
      status: 400,
    });
  });

  it('accepts the toggle with a key typed in the same save [SSO-R16]', async () => {
    await expect(
      upsertSamlConnection(slugSql('acme'), 'org-1', actor, {
        ...saml,
        spCertificate:
          '-----BEGIN CERTIFICATE-----\nSP\n-----END CERTIFICATE-----',
        spPrivateKey: 'typed-key',
        wantAssertionsEncrypted: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('refuses readably instead of clobbering a corrupt connection file [SSO-R17]', async () => {
    const file = await corruptConnectionFile(configRoot, 'acme');

    const attempt = upsertSamlConnection(slugSql('acme'), 'org-1', actor, {
      ...saml,
      spPrivateKey: 'typed-key',
    });

    await expect(attempt).rejects.toBeInstanceOf(SsoAdminError);
    await expect(attempt).rejects.toMatchObject({
      code: 'sso_config_unreadable',
      status: 409,
    });
    expect(await readFile(file, 'utf8')).toBe('protocol: [saml\n');
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
        spCertificate:
          '-----BEGIN CERTIFICATE-----\nSP\n-----END CERTIFICATE-----',
        wantAssertionsEncrypted: true,
      }),
    ).resolves.toBeUndefined();
  });
});

/**
 * The view's `hasSpKeypair` is what the form reads to know a blank key field
 * keeps a stored key — so it must report the STORED KEY (the secrets
 * sidecar), the same fact the encryption guard checks, not the public
 * certificate that happens to sit next to it in the config file.
 */
describe('getSsoConnectionView — hasSpKeypair reports the stored key', () => {
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
    idpCertificate:
      '-----BEGIN CERTIFICATE-----\nIDP\n-----END CERTIFICATE-----',
    autoProvisionRole: false,
    defaultRole: 'member' as const,
    roleMappingRules: [],
    autoProvisionTeam: false,
    excludeGroups: [],
  };
  const spCertificate =
    '-----BEGIN CERTIFICATE-----\nSP\n-----END CERTIFICATE-----';

  async function samlView(): Promise<Record<string, unknown> | null> {
    const view = await getSsoConnectionView(slugSql('acme'), 'org-1');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the view's saml block
    return view.saml as Record<string, unknown> | null;
  }

  it('is false with a certificate but no key stored', async () => {
    await upsertSamlConnection(slugSql('acme'), 'org-1', actor, {
      ...saml,
      spCertificate,
    });

    expect(await samlView()).toMatchObject({
      hasSpKeypair: false,
      spCertificate,
    });
  });

  it('is true once a key is stored, and stays true when the certificate is cleared', async () => {
    await upsertSamlConnection(slugSql('acme'), 'org-1', actor, {
      ...saml,
      spCertificate,
      spPrivateKey: 'typed-key',
    });
    expect(await samlView()).toMatchObject({ hasSpKeypair: true });

    await upsertSamlConnection(slugSql('acme'), 'org-1', actor, saml);
    const view = await samlView();
    expect(view).toMatchObject({ hasSpKeypair: true });
    expect(view).not.toHaveProperty('spPrivateKey');
    expect(view?.spCertificate).toBeUndefined();
  });

  it('refuses readably when the secrets sidecar is corrupt', async () => {
    await upsertSamlConnection(slugSql('acme'), 'org-1', actor, {
      ...saml,
      spCertificate,
    });
    await writeFile(
      path.join(
        configRoot,
        'acme',
        'governance',
        'sso',
        'connection.secrets.json',
      ),
      '{not json',
    );

    const attempt = getSsoConnectionView(slugSql('acme'), 'org-1');

    await expect(attempt).rejects.toBeInstanceOf(SsoAdminError);
    await expect(attempt).rejects.toMatchObject({
      code: 'sso_config_unreadable',
      status: 409,
    });
  });
});

describe('getSsoConnectionView — unreadable connection config', () => {
  let configRoot: string;
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    savedConfigDir = process.env.TALE_CONFIG_DIR;
    configRoot = await mkdtemp(path.join(tmpdir(), 'tale-sso-admin-'));
    process.env.TALE_CONFIG_DIR = configRoot;
    clearOrgConfigCaches();
    await corruptConnectionFile(configRoot, 'acme');
  });

  afterEach(async () => {
    if (savedConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
    else process.env.TALE_CONFIG_DIR = savedConfigDir;
    await rm(configRoot, { recursive: true, force: true });
    clearOrgConfigCaches();
  });

  it('refuses with a repair message instead of returning unconfigured', async () => {
    await expect(
      getSsoConnectionView(slugSql('acme'), 'org-1'),
    ).rejects.toMatchObject({
      code: 'sso_config_unreadable',
      status: 409,
      message: expect.stringContaining('repair connection.yml'),
    });
  });
});

/**
 * `trustEmail` lets an operator vouch for the address in the mapped email
 * claim, so a sign-in marks the user's email verified. It only means
 * something for a generic OIDC connection that maps the email claim; the
 * settings form does not show it, so a save that omits it keeps it.
 */
describe('upsertOidcConnection — the operator vouches for the mapped email [SSO-R20]', () => {
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
  const oidc = {
    displayName: 'Acme OIDC',
    providerId: 'generic-oidc' as const,
    issuer: 'https://idp.acme.test',
    clientId: 'client-1',
    clientSecret: 'secret-1',
    scopes: ['openid', 'email'],
    autoProvisionRole: false,
    defaultRole: 'member' as const,
    roleMappingRules: [],
    autoProvisionTeam: false,
    excludeGroups: [],
  };

  async function stored() {
    return (await readExisting('acme')).config?.oidc;
  }

  it('stores the flag with a mapped email claim', async () => {
    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, {
      ...oidc,
      claimMappings: { email: 'upn' },
      trustEmail: true,
    });

    expect((await stored())?.trustEmail).toBe(true);
  });

  it('reaches the sign-in config and the settings view as stored', async () => {
    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, {
      ...oidc,
      claimMappings: { email: 'upn' },
      trustEmail: true,
    });

    await expect(
      resolveSignInConfig(slugSql('acme'), 'org-1'),
    ).resolves.toMatchObject({
      claimMappings: { email: 'upn' },
      trustEmail: true,
    });
    await expect(
      getSsoConnectionView(slugSql('acme'), 'org-1'),
    ).resolves.toMatchObject({ oidc: { trustEmail: true } });

    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, {
      ...oidc,
      clientSecret: undefined,
      claimMappings: { email: 'upn' },
      trustEmail: false,
    });

    await expect(
      resolveSignInConfig(slugSql('acme'), 'org-1'),
    ).resolves.toMatchObject({ trustEmail: false });
    await expect(
      getSsoConnectionView(slugSql('acme'), 'org-1'),
    ).resolves.toMatchObject({ oidc: { trustEmail: false } });
  });

  it('refuses the flag without a mapped email claim and writes nothing', async () => {
    const attempt = upsertOidcConnection(slugSql('acme'), 'org-1', actor, {
      ...oidc,
      claimMappings: { name: 'name' },
      trustEmail: true,
    });

    await expect(attempt).rejects.toMatchObject({
      code: 'sso_trust_email_needs_email_claim',
      status: 400,
    });
    expect(await stored()).toBeUndefined();
  });

  it('refuses the flag for another provider', async () => {
    for (const providerId of ['entra-id', 'oauth2'] as const) {
      await expect(
        upsertOidcConnection(slugSql('acme'), 'org-1', actor, {
          ...oidc,
          providerId,
          claimMappings: { email: 'upn' },
          trustEmail: true,
        }),
      ).rejects.toMatchObject({ code: 'sso_trust_email_unsupported' });
    }
    expect(await stored()).toBeUndefined();
  });

  it('keeps the stored flag when a save omits it', async () => {
    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, {
      ...oidc,
      claimMappings: { email: 'upn' },
      trustEmail: true,
    });

    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, {
      ...oidc,
      displayName: 'Renamed',
      clientSecret: undefined,
      claimMappings: { email: 'upn' },
    });

    expect((await stored())?.trustEmail).toBe(true);
  });

  it('drops the stored flag when a save removes the email mapping', async () => {
    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, {
      ...oidc,
      claimMappings: { email: 'upn' },
      trustEmail: true,
    });

    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, {
      ...oidc,
      clientSecret: undefined,
    });

    expect((await stored())?.trustEmail).toBeUndefined();
  });

  it('clears the flag when a save sets it to false', async () => {
    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, {
      ...oidc,
      claimMappings: { email: 'upn' },
      trustEmail: true,
    });

    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, {
      ...oidc,
      clientSecret: undefined,
      claimMappings: { email: 'upn' },
      trustEmail: false,
    });

    expect((await stored())?.trustEmail).toBe(false);
  });

  it('leaves a connection that never had the flag without one', async () => {
    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, {
      ...oidc,
      claimMappings: { email: 'upn' },
    });

    expect((await stored())?.trustEmail).toBeUndefined();
  });
});

/**
 * The audit row of a save is how an admin learns who changed the settings
 * that decide every SSO sign-in's role and teams, and what they were before.
 * It names a secret the save replaced and never holds its value.
 */
describe('saving the settings records what changed, never a secret [SSO-R21]', () => {
  let configRoot: string;
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    savedConfigDir = process.env.TALE_CONFIG_DIR;
    configRoot = await mkdtemp(path.join(tmpdir(), 'tale-sso-admin-'));
    process.env.TALE_CONFIG_DIR = configRoot;
    clearOrgConfigCaches();
    vi.mocked(createAuditLog).mockClear();
  });

  afterEach(async () => {
    if (savedConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
    else process.env.TALE_CONFIG_DIR = savedConfigDir;
    await rm(configRoot, { recursive: true, force: true });
    clearOrgConfigCaches();
  });

  const actor = { userId: 'user-1', email: 'admin@acme.test', role: 'admin' };
  const provisioning = {
    autoProvisionRole: false,
    defaultRole: 'member' as const,
    roleMappingRules: [],
    autoProvisionTeam: true,
    excludeGroups: [],
  };
  const oidc = {
    displayName: 'Acme OIDC',
    providerId: 'generic-oidc' as const,
    issuer: 'https://idp.acme.test',
    clientId: 'acme-client-id-7f3',
    clientSecret: 'acme-client-secret-9q2',
    scopes: ['openid', 'email'],
    ...provisioning,
  };
  // Certificate bodies are base64 DER: `AAEC` is the bytes 00 01 02.
  const saml = {
    displayName: 'Acme SAML',
    idpEntityId: 'https://idp.acme.test/entity',
    idpSsoUrl: 'https://idp.acme.test/sso',
    idpCertificate:
      '-----BEGIN CERTIFICATE-----\nAAEC\n-----END CERTIFICATE-----',
    ...provisioning,
  };
  /** SHA-256 of the bytes 00 01 02, as an identity provider prints it. */
  const fingerprintOfAAEC =
    'AE:4B:32:80:E5:6E:2F:AF:83:F4:14:A6:E3:DA:BE:9D:5F:BE:18:97:65:44:C0:5F:ED:12:1A:CC:B8:5B:53:FC';

  /** The audit rows the saves wrote, in order. */
  function rows(): CreateAuditLogArgs[] {
    return vi.mocked(createAuditLog).mock.calls.map(([, args]) => args);
  }

  it('records every field of a first OIDC save and names the credentials it set', async () => {
    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, oidc);

    expect(rows()).toHaveLength(1);
    const [row] = rows();
    expect(row).toMatchObject({
      action: 'sso_configure',
      category: 'security',
      resourceType: 'sso',
      resourceId: 'org-1',
    });
    expect(row?.previousState).toBeUndefined();
    expect(row?.newState).toEqual({
      enabled: true,
      protocol: 'oidc',
      displayName: 'Acme OIDC',
      domain: null,
      providerId: 'generic-oidc',
      issuer: 'https://idp.acme.test',
      authorizationEndpoint: null,
      tokenEndpoint: null,
      userinfoEndpoint: null,
      scopes: ['openid', 'email'],
      pkce: null,
      domainHint: null,
      claimMappings: null,
      trustEmail: null,
      autoProvisionRole: false,
      defaultRole: 'member',
      roleMappingRules: [],
      autoProvisionTeam: true,
      excludeGroups: [],
    });
    expect(row?.changedFields).toEqual([
      ...Object.keys(row?.newState ?? {}),
      'clientId',
      'clientSecret',
    ]);
  });

  it('records the provisioning before and after when an OIDC save changes it', async () => {
    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, oidc);
    const { clientSecret: _kept, ...withoutSecret } = oidc;

    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, {
      ...withoutSecret,
      defaultRole: 'editor',
      roleMappingRules: [
        { source: 'group', pattern: 'it-admins', targetRole: 'admin' },
      ],
      autoProvisionTeam: false,
    });

    const row = rows()[1];
    expect(row?.changedFields).toEqual([
      'defaultRole',
      'roleMappingRules',
      'autoProvisionTeam',
    ]);
    expect(row?.previousState).toMatchObject({
      defaultRole: 'member',
      roleMappingRules: [],
      autoProvisionTeam: true,
    });
    expect(row?.newState).toMatchObject({
      defaultRole: 'editor',
      roleMappingRules: [
        { source: 'group', pattern: 'it-admins', targetRole: 'admin' },
      ],
      autoProvisionTeam: false,
    });
  });

  it('names a replaced client secret and client id without recording either', async () => {
    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, oidc);

    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, {
      ...oidc,
      clientId: 'acme-client-id-8k1',
      clientSecret: 'acme-client-secret-4m5',
    });

    const row = rows()[1];
    expect(row?.changedFields).toEqual(['clientId', 'clientSecret']);
    expect(row?.previousState).toEqual(row?.newState);
    const recorded = JSON.stringify(rows());
    for (const secret of [
      'acme-client-id-7f3',
      'acme-client-secret-9q2',
      'acme-client-id-8k1',
      'acme-client-secret-4m5',
    ]) {
      expect(recorded).not.toContain(secret);
    }
  });

  it('records a SAML connection with certificate fingerprints, and its key only by name', async () => {
    await upsertSamlConnection(slugSql('acme'), 'org-1', actor, {
      ...saml,
      spCertificate: saml.idpCertificate,
      spPrivateKey: 'acme-sp-private-key-2v8',
    });
    await upsertSamlConnection(slugSql('acme'), 'org-1', actor, {
      ...saml,
      spCertificate: saml.idpCertificate,
      wantAssertionsEncrypted: true,
    });

    const [first, second] = rows();
    expect(first?.newState).toEqual({
      enabled: true,
      protocol: 'saml',
      displayName: 'Acme SAML',
      domain: null,
      idpEntityId: 'https://idp.acme.test/entity',
      idpSsoUrl: 'https://idp.acme.test/sso',
      idpCertificate: fingerprintOfAAEC,
      spCertificate: fingerprintOfAAEC,
      hasSpKeypair: true,
      wantAssertionsSigned: null,
      wantAssertionsEncrypted: null,
      attributeMappings: null,
      ...provisioning,
    });
    expect(first?.changedFields).toContain('spPrivateKey');
    // The key was kept (left blank), so only the toggle changed.
    expect(second?.changedFields).toEqual(['wantAssertionsEncrypted']);
    expect(JSON.stringify(rows())).not.toContain('acme-sp-private-key-2v8');
    expect(JSON.stringify(rows())).not.toContain('BEGIN CERTIFICATE');
  });

  it('records what a provisioning-only save changes against the stored connection', async () => {
    await upsertOidcConnection(slugSql('acme'), 'org-1', actor, oidc);

    await setSsoProvisioning(slugSql('acme'), 'org-1', actor, {
      ...provisioning,
      autoProvisionTeam: false,
      excludeGroups: ['all-staff'],
    });

    const row = rows()[1];
    expect(row?.action).toBe('sso_configure');
    expect(row?.changedFields).toEqual(['autoProvisionTeam', 'excludeGroups']);
    expect(row?.previousState).toMatchObject({
      issuer: 'https://idp.acme.test',
      autoProvisionTeam: true,
      excludeGroups: [],
    });
    expect(row?.newState).toMatchObject({
      issuer: 'https://idp.acme.test',
      autoProvisionTeam: false,
      excludeGroups: ['all-staff'],
    });
    expect(JSON.stringify(row)).not.toContain('acme-client-secret-9q2');
  });
});

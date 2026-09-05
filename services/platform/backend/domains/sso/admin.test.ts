// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SsoProviderAdapter } from '../../core/enterprise_sso/types.ts';
import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { testSsoConnection } from './admin.ts';

/** The adapter under "Test connection": records what it was asked to probe. */
const { validateConfig } = vi.hoisted(() => ({
  validateConfig: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock('../../core/enterprise_sso/registry.ts', () => ({
  getAdapter: (providerId: string): SsoProviderAdapter | null =>
    providerId === 'entra-id'
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only validateConfig is exercised
        ({ providerId, validateConfig } as unknown as SsoProviderAdapter)
      : null,
}));

/** Sql double answering the org-slug lookup only. */
function slugSql(slug: string): Sql {
  const tag = (strings: TemplateStringsArray) =>
    Promise.resolve(
      strings.join('$?').includes('SELECT "slug" FROM "organization"')
        ? [{ slug }]
        : [],
    );
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

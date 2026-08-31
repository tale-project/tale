// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { clearOrgConfigCaches } from '../../lib/org-config.ts';
import { resolveEntraSsoSource } from './sso-reuse.ts';

const ORG_ID = 'org-1';
const ORG_SLUG = 'acme';
const TENANT = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeee0000';

/** Answers the org-slug lookup (`resolveOrgSlug`) — the only query the
 * resolver issues; the connection itself is read from disk. */
function fakeSql(): Sql {
  const tag = (..._args: unknown[]) => Promise.resolve([{ slug: ORG_SLUG }]);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
}

let configRoot: string;
let savedConfigDir: string | undefined;

beforeEach(async () => {
  savedConfigDir = process.env.TALE_CONFIG_DIR;
  configRoot = await mkdtemp(path.join(tmpdir(), 'tale-sso-reuse-'));
  process.env.TALE_CONFIG_DIR = configRoot;
  clearOrgConfigCaches();
});

afterEach(async () => {
  if (savedConfigDir === undefined) {
    delete process.env.TALE_CONFIG_DIR;
  } else {
    process.env.TALE_CONFIG_DIR = savedConfigDir;
  }
  await rm(configRoot, { recursive: true, force: true });
  clearOrgConfigCaches();
});

async function seedConnection(yaml: string): Promise<void> {
  const dir = path.join(configRoot, ORG_SLUG, 'governance', 'sso');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'connection.yml'), yaml);
}

async function seedSecrets(secrets: Record<string, string>): Promise<void> {
  const dir = path.join(configRoot, ORG_SLUG, 'governance', 'sso');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'connection.secrets.json'),
    JSON.stringify(secrets),
  );
}

function entraConnectionYaml(issuer: string, enabled = true): string {
  return [
    `enabled: ${enabled}`,
    'protocol: oidc',
    'displayName: Microsoft Entra ID',
    'oidc:',
    '  providerId: entra-id',
    `  issuer: ${issuer}`,
    '  scopes: [openid, email, profile, offline_access]',
  ].join('\n');
}

describe('resolveEntraSsoSource', () => {
  test('resolves the registration from an enabled Entra connection', async () => {
    await seedConnection(
      entraConnectionYaml(`https://login.microsoftonline.com/${TENANT}/v2.0`),
    );
    await seedSecrets({
      clientId: '  sso-client-id  ',
      clientSecret: 'sso-client-secret',
    });
    expect(await resolveEntraSsoSource(fakeSql(), ORG_ID)).toEqual({
      ok: true,
      clientId: 'sso-client-id',
      clientSecret: 'sso-client-secret',
      tenantId: TENANT,
    });
  });

  test('accepts a bare Directory (tenant) ID as the issuer', async () => {
    await seedConnection(entraConnectionYaml(TENANT));
    await seedSecrets({ clientId: 'id', clientSecret: 'secret' });
    const source = await resolveEntraSsoSource(fakeSql(), ORG_ID);
    expect(source).toMatchObject({ ok: true, tenantId: TENANT });
  });

  test('no connection file → no_sso', async () => {
    expect(await resolveEntraSsoSource(fakeSql(), ORG_ID)).toEqual({
      ok: false,
      reason: 'no_sso',
    });
  });

  test('a disabled connection → no_sso', async () => {
    await seedConnection(
      entraConnectionYaml(
        `https://login.microsoftonline.com/${TENANT}/v2.0`,
        false,
      ),
    );
    await seedSecrets({ clientId: 'id', clientSecret: 'secret' });
    expect(await resolveEntraSsoSource(fakeSql(), ORG_ID)).toEqual({
      ok: false,
      reason: 'no_sso',
    });
  });

  test('a SAML sign-in with a stale oidc block → no_sso', async () => {
    await seedConnection(
      [
        'enabled: true',
        'protocol: saml',
        'displayName: Corp SAML',
        'saml:',
        '  idpEntityId: urn:corp',
        '  idpSsoUrl: https://idp.example.com/sso',
        '  idpCertificate: cert',
        'oidc:',
        '  providerId: entra-id',
        `  issuer: https://login.microsoftonline.com/${TENANT}/v2.0`,
      ].join('\n'),
    );
    await seedSecrets({ clientId: 'id', clientSecret: 'secret' });
    expect(await resolveEntraSsoSource(fakeSql(), ORG_ID)).toEqual({
      ok: false,
      reason: 'no_sso',
    });
  });

  test('a non-Entra OIDC provider → not_entra', async () => {
    await seedConnection(
      [
        'enabled: true',
        'protocol: oidc',
        'displayName: Okta',
        'oidc:',
        '  providerId: generic-oidc',
        '  issuer: https://corp.okta.com',
      ].join('\n'),
    );
    await seedSecrets({ clientId: 'id', clientSecret: 'secret' });
    expect(await resolveEntraSsoSource(fakeSql(), ORG_ID)).toEqual({
      ok: false,
      reason: 'not_entra',
    });
  });

  test('an issuer with no readable tenant → bad_issuer', async () => {
    await seedConnection(
      entraConnectionYaml(`https://sts.windows.net/${TENANT}/`),
    );
    await seedSecrets({ clientId: 'id', clientSecret: 'secret' });
    expect(await resolveEntraSsoSource(fakeSql(), ORG_ID)).toEqual({
      ok: false,
      reason: 'bad_issuer',
    });
  });

  test('a secrets sidecar without a client secret → missing_credentials', async () => {
    await seedConnection(
      entraConnectionYaml(`https://login.microsoftonline.com/${TENANT}/v2.0`),
    );
    await seedSecrets({ clientId: 'id' });
    expect(await resolveEntraSsoSource(fakeSql(), ORG_ID)).toEqual({
      ok: false,
      reason: 'missing_credentials',
    });
  });

  test('a missing secrets sidecar → missing_credentials', async () => {
    await seedConnection(
      entraConnectionYaml(`https://login.microsoftonline.com/${TENANT}/v2.0`),
    );
    expect(await resolveEntraSsoSource(fakeSql(), ORG_ID)).toEqual({
      ok: false,
      reason: 'missing_credentials',
    });
  });
});

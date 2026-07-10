// @vitest-environment node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { beforeEach, expect, vi } from 'vitest';

import { encryptString } from '../../../../lib/crypto/encrypt_string';
import { atomicWrite, readFileSafe } from '../../../../lib/file_io';
import { buildModules } from '../../../framework/test_helpers';
import {
  defineMigrationTest,
  type WorldHandle,
} from '../../../testing/harness.testkit';

// World-building imports the whole convex tree; under the fully parallel suite
// the default 5s budget flakes — and a timed-out ritual's zombie async work
// can then corrupt the file's later tests. Chain tests size timeouts likewise.
vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_2_87/01_enterprise_sso_unify';

// The harness stubs ENCRYPTION_SECRET_HEX (the corpus key) before `seed`
// runs, so seeding encrypts with the SAME key the handler decrypts with.
// getSecretKey() prefers ENCRYPTION_SECRET (base64) when present — delete it
// so a developer-shell value can't shadow the stubbed hex key.
beforeEach(() => {
  vi.stubEnv('ENCRYPTION_SECRET', undefined);
});

function connectionPath(world: WorldHandle, slug: string): string {
  return path.join(
    world.configRoot,
    slug,
    'governance',
    'sso',
    'connection.json',
  );
}
function secretsPath(world: WorldHandle, slug: string): string {
  return path.join(
    world.configRoot,
    slug,
    'governance',
    'sso',
    'connection.secrets.json',
  );
}

// Harness ritual: real fleet up (incl. the real sso configCache sync),
// handler idempotency over migrated state (same files rewritten with the
// same content), down restoring the seeded world digest — the untouched
// ssoProviders ciphertext rows AND the (absent) sso/ files — and the ledger.
defineMigrationTest({
  id: '0.2.87/01_enterprise_sso_unify',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seed(ctx, orgs) {
    // Encrypted AT SEED TIME with the app's own crypto under the stubbed
    // world key — the handler must round-trip these back to plaintext.
    await ctx.db.insert('ssoProviders', {
      organizationId: orgs[0].id,
      providerId: 'entra-id',
      issuer: 'https://login.microsoftonline.com/tid/v2.0',
      clientIdEncrypted: await encryptString('the-client-id'),
      clientSecretEncrypted: await encryptString('the-client-secret'),
      scopes: ['openid', 'email', 'profile'],
      autoProvisionRole: true,
      roleMappingRules: [
        { source: 'group', pattern: '*admin*', targetRole: 'admin' },
      ],
      defaultRole: 'member',
      providerFeatures: {
        entraId: {
          autoProvisionTeam: true,
          excludeGroups: ['Everyone'],
          enableOneDriveAccess: true,
          domainHint: 'acme.com',
        },
      },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    // org2 has no legacy ssoProviders row: the per-org no-op path.
  },

  async expectUp(world) {
    const [org1, org2] = world.orgs;

    // connection.json mapped from the legacy row.
    const connection = JSON.parse(
      await readFile(connectionPath(world, org1.slug), 'utf-8'),
    );
    expect(connection).toMatchObject({
      enabled: true,
      protocol: 'oidc',
      displayName: 'Enterprise SSO',
      oidc: {
        providerId: 'entra-id',
        issuer: 'https://login.microsoftonline.com/tid/v2.0',
        scopes: ['openid', 'email', 'profile'],
        domainHint: 'acme.com',
        enableOneDriveAccess: true,
      },
      provisioning: {
        autoProvisionRole: true,
        defaultRole: 'member',
        autoProvisionTeam: true,
        excludeGroups: ['Everyone'],
      },
    });
    expect(connection.provisioning.roleMappingRules).toHaveLength(1);

    // connection.secrets.json carries the DECRYPTED credentials.
    const secrets = JSON.parse(
      await readFile(secretsPath(world, org1.slug), 'utf-8'),
    );
    expect(secrets).toEqual({
      clientId: 'the-client-id',
      clientSecret: 'the-client-secret',
    });

    // The real syncConnectionCache mirrored the file into configCache.
    const cache = await world.run<Array<Record<string, unknown>>>((ctx) =>
      ctx.db.query('configCache').collect(),
    );
    const ssoRows = (orgId: string) =>
      cache.filter(
        (row: Record<string, unknown>) =>
          row.organizationId === orgId && row.domain === 'sso',
      );
    expect(
      ssoRows(org1.id).map((row: Record<string, unknown>) => row.key),
    ).toEqual(['connection']);
    expect(ssoRows(org2.id)).toEqual([]);

    // org2 had no legacy row — no files appear.
    expect(await readFileSafe(connectionPath(world, org2.slug))).toBeNull();
    expect(await readFileSafe(secretsPath(world, org2.slug))).toBeNull();
  },

  cases: {
    'down restores prior sso files that existed before up': async (world) => {
      // Seed a pre-existing connection.json so the snapshot is non-empty.
      await atomicWrite(
        connectionPath(world, world.orgs[0].slug),
        '{"enabled":false}\n',
      );
      await world.applyUpOnly();
      // up overwrote it.
      expect(
        await readFileSafe(connectionPath(world, world.orgs[0].slug)),
      ).not.toBe('{"enabled":false}\n');

      await world.applyDownOnly();
      expect(
        await readFileSafe(connectionPath(world, world.orgs[0].slug)),
      ).toBe('{"enabled":false}\n');
    },
  },
});

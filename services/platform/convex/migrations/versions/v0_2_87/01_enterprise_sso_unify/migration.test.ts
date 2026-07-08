// @vitest-environment node

/**
 * The node migration touches the real filesystem (snapshot + atomicWrite) and
 * decrypts the legacy encrypted credentials, so this test runs in the node
 * environment (the rest of convex/** runs in edge-runtime). It exercises the
 * handler directly with a stub Convex ctx — org enumeration and the configCache
 * sync (which need the Better Auth component / node_runner) are out of scope
 * here and covered by the runner/config_cache tests; this proves the
 * file + secrets export, the decrypt, idempotency, and the fs-snapshot rollback.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptString } from '../../../../lib/crypto/decrypt_string';
import { encryptString } from '../../../../lib/crypto/encrypt_string';
import {
  atomicWrite,
  readFileSafe,
  removeDirSafe,
  removeFileSafe,
} from '../../../../lib/file_io';
import {
  restoreFsTree,
  snapshotFsTree,
} from '../../../framework/snapshot_store';
import type {
  NodeMigrationCtx,
  NodeMigrationHelpers,
} from '../../../framework/types';
import { migration } from './index';
import type { LegacySsoProviderRow } from './legacy_sso';

// A valid 32-byte (64 hex char) key so getSecretKey() accepts it; the test owns
// its own deterministic encryption secret.
const ENCRYPTION_SECRET_HEX =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

const helpers: NodeMigrationHelpers = {
  atomicWrite,
  readFileSafe,
  removeFileSafe,
  removeDirSafe,
  snapshotFsTree,
  restoreFsTree,
};

function stubCtx(row: LegacySsoProviderRow | null): NodeMigrationCtx {
  return {
    runQuery: async () => row,
    runAction: async () => null,
    runMutation: async () => null,
  };
}

const ORG = { id: 'org1', slug: 'org1' };

async function legacyRow(): Promise<LegacySsoProviderRow> {
  return {
    _id: 'p1',
    organizationId: 'org1',
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
  };
}

describe('0.2.87/01 enterprise_sso_unify', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tale-mig-sso-'));
    vi.stubEnv('TALE_CONFIG_DIR', dir);
    vi.stubEnv('ENCRYPTION_SECRET_HEX', ENCRYPTION_SECRET_HEX);
    // getSecretKey() prefers ENCRYPTION_SECRET (base64) when present; unset it
    // (stubEnv(undefined) deletes the var) so the hex test key is the one used.
    vi.stubEnv('ENCRYPTION_SECRET', undefined);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  const connectionPath = () =>
    path.join(dir, 'org1', 'governance', 'sso', 'connection.json');
  const secretsPath = () =>
    path.join(dir, 'org1', 'governance', 'sso', 'connection.secrets.json');

  it('up writes connection.json mapped from the legacy row', async () => {
    await migration.up(stubCtx(await legacyRow()), ORG, helpers);

    const connection = JSON.parse(await readFile(connectionPath(), 'utf-8'));
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
  });

  it('up writes connection.secrets.json with DECRYPTED credentials', async () => {
    await migration.up(stubCtx(await legacyRow()), ORG, helpers);

    const secrets = JSON.parse(await readFile(secretsPath(), 'utf-8'));
    expect(secrets).toEqual({
      clientId: 'the-client-id',
      clientSecret: 'the-client-secret',
    });
    // Sanity: the legacy values really were ciphertext (round-trips back).
    const row = await legacyRow();
    expect(await decryptString(row.clientIdEncrypted)).toBe('the-client-id');
  });

  it('a second up is an idempotent no-op (same file content)', async () => {
    const row = await legacyRow();
    await migration.up(stubCtx(row), ORG, helpers);
    const first = await readFile(connectionPath(), 'utf-8');
    const firstSecrets = await readFile(secretsPath(), 'utf-8');

    await migration.up(stubCtx(row), ORG, helpers);
    expect(await readFile(connectionPath(), 'utf-8')).toBe(first);
    expect(await readFile(secretsPath(), 'utf-8')).toBe(firstSecrets);
  });

  it('up is a no-op for an org with no legacy ssoProviders row', async () => {
    await migration.up(stubCtx(null), ORG, helpers);
    expect(await readFileSafe(connectionPath())).toBeNull();
    expect(await readFileSafe(secretsPath())).toBeNull();
  });

  it('down restores the pre-migration sso dir from the snapshot', async () => {
    const row = await legacyRow();
    // No sso/ files existed before up, so the snapshot is empty and down must
    // remove the files up created — restoring the prior (empty) state.
    await migration.up(stubCtx(row), ORG, helpers);
    expect(await readFileSafe(connectionPath())).not.toBeNull();
    expect(await readFileSafe(secretsPath())).not.toBeNull();

    await migration.down(stubCtx(row), ORG, helpers);
    expect(await readFileSafe(connectionPath())).toBeNull();
    expect(await readFileSafe(secretsPath())).toBeNull();
  });

  it('down restores prior sso files that existed before up', async () => {
    // Seed a pre-existing connection.json so the snapshot is non-empty.
    await atomicWrite(connectionPath(), '{"enabled":false}\n');
    const row = await legacyRow();

    await migration.up(stubCtx(row), ORG, helpers);
    // up overwrote it.
    expect(await readFileSafe(connectionPath())).not.toBe(
      '{"enabled":false}\n',
    );

    await migration.down(stubCtx(row), ORG, helpers);
    expect(await readFileSafe(connectionPath())).toBe('{"enabled":false}\n');
  });
});

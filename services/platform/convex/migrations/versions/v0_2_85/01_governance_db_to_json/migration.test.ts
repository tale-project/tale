// @vitest-environment node

/**
 * The node migration touches the real filesystem (snapshot + atomicWrite), so
 * this test runs in the node environment (the rest of convex/** runs in
 * edge-runtime). It exercises the handler directly with a stub Convex ctx —
 * org enumeration and the configCache sync (which need the Better Auth
 * component) are out of scope here and covered by the runner/config_cache
 * tests; this proves the file export + fs-snapshot rollback.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import type { LegacyGovernancePolicyRow } from '../legacy_governance';
import { migration } from './index';

const helpers: NodeMigrationHelpers = {
  atomicWrite,
  readFileSafe,
  removeFileSafe,
  removeDirSafe,
  snapshotFsTree,
  restoreFsTree,
};

function stubCtx(rows: LegacyGovernancePolicyRow[]): NodeMigrationCtx {
  return {
    runQuery: async () => rows,
    runAction: async () => null,
    runMutation: async () => null,
  };
}

describe('0.2.85/01 governance_db_to_json', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tale-mig-gov-'));
    vi.stubEnv('TALE_CONFIG_DIR', dir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  const filePath = () =>
    path.join(dir, 'org1', 'governance', 'password-policy.json');

  it('up writes the policy to its kebab-case JSON file', async () => {
    const rows: LegacyGovernancePolicyRow[] = [
      {
        _id: 'p1',
        organizationId: 'org1',
        policyType: 'password_policy',
        config: { minLength: 16 },
      },
    ];
    await migration.up(stubCtx(rows), { id: 'org1', slug: 'org1' }, helpers);

    const written = JSON.parse(await readFile(filePath(), 'utf-8'));
    expect(written).toMatchObject({ minLength: 16, requireUpper: true });
  });

  it('down restores the pre-migration governance dir from the snapshot', async () => {
    const rows: LegacyGovernancePolicyRow[] = [
      {
        _id: 'p1',
        organizationId: 'org1',
        policyType: 'password_policy',
        config: { minLength: 16 },
      },
    ];
    const org = { id: 'org1', slug: 'org1' };
    // No governance files existed before up, so the snapshot is empty and down
    // must remove the file up created — restoring the prior (empty) state.
    await migration.up(stubCtx(rows), org, helpers);
    expect(await readFileSafe(filePath())).not.toBeNull();

    await migration.down(stubCtx(rows), org, helpers);
    expect(await readFileSafe(filePath())).toBeNull();
  });

  it('skips non-file policy types', async () => {
    const rows: LegacyGovernancePolicyRow[] = [
      {
        _id: 'x',
        organizationId: 'org1',
        policyType: 'personalization', // legacy, not a FilePolicyType
        config: { enabled: true },
      },
    ];
    await migration.up(stubCtx(rows), { id: 'org1', slug: 'org1' }, helpers);
    expect(
      await readFileSafe(
        path.join(dir, 'org1', 'governance', 'personalization.json'),
      ),
    ).toBeNull();
  });
});

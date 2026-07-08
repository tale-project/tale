// @vitest-environment node

/**
 * The node migration touches the real filesystem (snapshot + atomicWrite), so
 * this runs in the node environment. It exercises the handler directly with a
 * stub Convex ctx — org enumeration + configCache sync are covered by the
 * runner/config_cache tests; this proves the file export + fs-snapshot rollback.
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
import type { LegacyOrgPackagePolicyRow } from '../legacy_run_code_model_sync';
import { migration } from './index';

const helpers: NodeMigrationHelpers = {
  atomicWrite,
  readFileSafe,
  removeFileSafe,
  removeDirSafe,
  snapshotFsTree,
  restoreFsTree,
};

function stubCtx(rows: LegacyOrgPackagePolicyRow[]): NodeMigrationCtx {
  return {
    runQuery: async () => rows,
    runAction: async () => null,
    runMutation: async () => null,
  };
}

const ROW: LegacyOrgPackagePolicyRow = {
  _id: 'p1',
  organizationId: 'org1',
  defaultMode: 'allowlist',
  pythonAllow: ['numpy'],
  pythonDeny: [],
  nodeAllow: [],
  nodeDeny: ['left-pad'],
};

describe('0.2.87/02 run_code_policy_db_to_json', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tale-mig-runcode-'));
    vi.stubEnv('TALE_CONFIG_DIR', dir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  const filePath = () => path.join(dir, 'org1', 'governance', 'run-code.json');

  it('up writes the policy to run-code.json with schema defaults applied', async () => {
    await migration.up(stubCtx([ROW]), { id: 'org1', slug: 'org1' }, helpers);
    const written = JSON.parse(await readFile(filePath(), 'utf-8'));
    expect(written).toMatchObject({
      defaultMode: 'allowlist',
      pythonAllow: ['numpy'],
      nodeDeny: ['left-pad'],
      pythonDeny: [],
      nodeAllow: [],
    });
  });

  it('up is a no-op when the org has no legacy row', async () => {
    await migration.up(stubCtx([]), { id: 'org1', slug: 'org1' }, helpers);
    expect(await readFileSafe(filePath())).toBeNull();
  });

  it('down restores the pre-migration governance dir from the snapshot', async () => {
    const org = { id: 'org1', slug: 'org1' };
    await migration.up(stubCtx([ROW]), org, helpers);
    expect(await readFileSafe(filePath())).not.toBeNull();

    await migration.down(stubCtx([ROW]), org, helpers);
    expect(await readFileSafe(filePath())).toBeNull();
  });
});

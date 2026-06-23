// @vitest-environment node

/**
 * Filesystem-touching node migration → node environment. Exercises the handler
 * directly with a stub Convex ctx; proves the file export + fs-snapshot
 * rollback. Org enumeration + configCache sync are covered elsewhere.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { atomicWrite, readFileSafe } from '../../../../lib/file_io';
import {
  restoreFsTree,
  snapshotFsTree,
} from '../../../framework/snapshot_store';
import type {
  NodeMigrationCtx,
  NodeMigrationHelpers,
} from '../../../framework/types';
import type { LegacyModelSyncSettingsRow } from '../legacy_run_code_model_sync';
import { migration } from './index';

const helpers: NodeMigrationHelpers = {
  atomicWrite,
  readFileSafe,
  snapshotFsTree,
  restoreFsTree,
};

function stubCtx(rows: LegacyModelSyncSettingsRow[]): NodeMigrationCtx {
  return {
    runQuery: async () => rows,
    runAction: async () => null,
    runMutation: async () => null,
  };
}

const ROW: LegacyModelSyncSettingsRow = {
  _id: 's1',
  organizationId: 'org1',
  autoSyncEnabled: false,
};

describe('0.2.87/03 model_sync_db_to_json', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tale-mig-modelsync-'));
    vi.stubEnv('TALE_CONFIG_DIR', dir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  const filePath = () =>
    path.join(dir, 'org1', 'governance', 'model-sync.json');

  it('up writes the opt-out to model-sync.json', async () => {
    await migration.up(stubCtx([ROW]), { id: 'org1', slug: 'org1' }, helpers);
    const written = JSON.parse(await readFile(filePath(), 'utf-8'));
    expect(written).toEqual({ autoSyncEnabled: false });
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

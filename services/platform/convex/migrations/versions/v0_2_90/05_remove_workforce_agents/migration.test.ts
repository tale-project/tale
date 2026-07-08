// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import { migration } from './index';

const helpers: NodeMigrationHelpers = {
  atomicWrite,
  readFileSafe,
  removeFileSafe,
  removeDirSafe,
  snapshotFsTree,
  restoreFsTree,
};

const ctx: NodeMigrationCtx = {
  runQuery: async () => null,
  runAction: async () => null,
  runMutation: async () => null,
};

const ORG = { id: 'org1', slug: 'org1' };
const ANALYST = JSON.stringify({ slug: 'analyst', supportedModels: [] });
const CHAT = JSON.stringify({ slug: 'assistant', supportedModels: [] });

describe('0.2.90/05 remove_workforce_agents', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tale-mig-wfagents-'));
    vi.stubEnv('TALE_CONFIG_DIR', dir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('deletes agents/workforce/ and leaves other folders untouched', async () => {
    const agentsDir = path.join(dir, ORG.slug, 'agents');
    await mkdir(path.join(agentsDir, 'workforce'), { recursive: true });
    await mkdir(path.join(agentsDir, 'chat'), { recursive: true });
    await writeFile(
      path.join(agentsDir, 'workforce', 'analyst.json'),
      ANALYST,
      'utf8',
    );
    await writeFile(
      path.join(agentsDir, 'chat', 'assistant.json'),
      CHAT,
      'utf8',
    );

    await migration.up(ctx, ORG, helpers);

    expect(
      await readFileSafe(path.join(agentsDir, 'workforce', 'analyst.json')),
    ).toBeNull();
    expect(
      await readFileSafe(path.join(agentsDir, 'chat', 'assistant.json')),
    ).toBe(CHAT);
  });

  it('down restores the deleted folder after up', async () => {
    const agentsDir = path.join(dir, ORG.slug, 'agents');
    await mkdir(path.join(agentsDir, 'workforce'), { recursive: true });
    await writeFile(
      path.join(agentsDir, 'workforce', 'analyst.json'),
      ANALYST,
      'utf8',
    );

    await migration.up(ctx, ORG, helpers);
    await migration.down(ctx, ORG, helpers);

    expect(
      await readFileSafe(path.join(agentsDir, 'workforce', 'analyst.json')),
    ).toBe(ANALYST);
  });

  it('is idempotent when the org has no workforce folder', async () => {
    const agentsDir = path.join(dir, ORG.slug, 'agents');
    await mkdir(path.join(agentsDir, 'chat'), { recursive: true });
    await writeFile(
      path.join(agentsDir, 'chat', 'assistant.json'),
      CHAT,
      'utf8',
    );

    await migration.up(ctx, ORG, helpers);
    await migration.up(ctx, ORG, helpers);

    expect(
      await readFileSafe(path.join(agentsDir, 'chat', 'assistant.json')),
    ).toBe(CHAT);
  });
});

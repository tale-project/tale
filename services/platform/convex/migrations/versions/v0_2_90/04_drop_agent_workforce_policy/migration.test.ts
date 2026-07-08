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
const POLICY = JSON.stringify({ enabled: true, maxConcurrentRunsOrg: 10 });
const OTHER = JSON.stringify({ minLength: 14 });

describe('0.2.90/04 drop_agent_workforce_policy', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tale-mig-agentworkforce-'));
    vi.stubEnv('TALE_CONFIG_DIR', dir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('deletes agent-workforce.json and leaves other policies untouched', async () => {
    const govDir = path.join(dir, ORG.slug, 'governance');
    await mkdir(govDir, { recursive: true });
    await writeFile(path.join(govDir, 'agent-workforce.json'), POLICY, 'utf8');
    await writeFile(path.join(govDir, 'password-policy.json'), OTHER, 'utf8');

    await migration.up(ctx, ORG, helpers);

    expect(
      await readFileSafe(path.join(govDir, 'agent-workforce.json')),
    ).toBeNull();
    expect(await readFileSafe(path.join(govDir, 'password-policy.json'))).toBe(
      OTHER,
    );
  });

  it('down restores the deleted policy file after up', async () => {
    const govDir = path.join(dir, ORG.slug, 'governance');
    await mkdir(govDir, { recursive: true });
    await writeFile(path.join(govDir, 'agent-workforce.json'), POLICY, 'utf8');

    await migration.up(ctx, ORG, helpers);
    await migration.down(ctx, ORG, helpers);

    expect(await readFileSafe(path.join(govDir, 'agent-workforce.json'))).toBe(
      POLICY,
    );
  });

  it('is idempotent when the org has no such policy file', async () => {
    const govDir = path.join(dir, ORG.slug, 'governance');
    await mkdir(govDir, { recursive: true });
    await writeFile(path.join(govDir, 'password-policy.json'), OTHER, 'utf8');

    await migration.up(ctx, ORG, helpers);
    await migration.up(ctx, ORG, helpers);

    expect(await readFileSafe(path.join(govDir, 'password-policy.json'))).toBe(
      OTHER,
    );
  });
});

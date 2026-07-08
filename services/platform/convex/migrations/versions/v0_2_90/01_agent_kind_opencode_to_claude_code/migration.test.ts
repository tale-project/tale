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

describe('0.2.90/01 agent_kind_opencode_to_claude_code', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tale-mig-agentkind-'));
    vi.stubEnv('TALE_CONFIG_DIR', dir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('rewrites opencode to claude-code and leaves cursor untouched', async () => {
    const agentsDir = path.join(dir, ORG.slug, 'agents', 'chat');
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      path.join(agentsDir, 'legacy.json'),
      JSON.stringify({
        primaryBehavior: 'external-agent',
        agentKind: 'opencode',
        supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
        i18n: { en: { displayName: 'Legacy' } },
      }),
      'utf8',
    );
    await writeFile(
      path.join(agentsDir, 'cursor.json'),
      JSON.stringify({
        primaryBehavior: 'external-agent',
        agentKind: 'cursor',
        supportedModels: [],
        i18n: { en: { displayName: 'Cursor' } },
      }),
      'utf8',
    );

    await migration.up(ctx, ORG, helpers);

    const legacyPath = path.join(agentsDir, 'legacy.json');
    const cursorPath = path.join(agentsDir, 'cursor.json');
    const legacyRaw = await readFileSafe(legacyPath);
    const cursorRaw = await readFileSafe(cursorPath);
    if (legacyRaw === null || cursorRaw === null) {
      throw new Error('expected agent files after migration');
    }
    const legacy = JSON.parse(legacyRaw) as { agentKind?: string };
    const cursor = JSON.parse(cursorRaw) as { agentKind?: string };
    expect(legacy.agentKind).toBe('claude-code');
    expect(cursor.agentKind).toBe('cursor');
  });

  it('down restores opencode after up', async () => {
    const agentsDir = path.join(dir, ORG.slug, 'agents', 'chat');
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      path.join(agentsDir, 'legacy.json'),
      JSON.stringify({
        primaryBehavior: 'external-agent',
        agentKind: 'opencode',
        supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
        i18n: { en: { displayName: 'Legacy' } },
      }),
      'utf8',
    );

    await migration.up(ctx, ORG, helpers);
    await migration.down(ctx, ORG, helpers);

    const legacyRaw = await readFileSafe(path.join(agentsDir, 'legacy.json'));
    if (legacyRaw === null) {
      throw new Error('expected legacy agent file after down');
    }
    const legacy = JSON.parse(legacyRaw) as { agentKind?: string };
    expect(legacy.agentKind).toBe('opencode');
  });

  it('is idempotent on a second up', async () => {
    const agentsDir = path.join(dir, ORG.slug, 'agents', 'chat');
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      path.join(agentsDir, 'legacy.json'),
      JSON.stringify({
        primaryBehavior: 'external-agent',
        agentKind: 'opencode',
        supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
        i18n: { en: { displayName: 'Legacy' } },
      }),
      'utf8',
    );

    await migration.up(ctx, ORG, helpers);
    await migration.up(ctx, ORG, helpers);

    const legacyPath = path.join(agentsDir, 'legacy.json');
    const legacyRaw = await readFileSafe(legacyPath);
    if (legacyRaw === null) {
      throw new Error('expected legacy agent file after migration');
    }
    const legacy = JSON.parse(legacyRaw) as { agentKind?: string };
    expect(legacy.agentKind).toBe('claude-code');
  });
});

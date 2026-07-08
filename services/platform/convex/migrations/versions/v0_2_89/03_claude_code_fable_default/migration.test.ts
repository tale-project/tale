// @vitest-environment node

/**
 * Filesystem-touching node migration → node environment. Exercises the handler
 * directly against a tmp TALE_CONFIG_DIR with the real fs helpers; proves the
 * catalog append + pin retarget, the operator-edit guards, idempotency, and
 * the exact in-place inverse. Org enumeration is covered by the runner tests.
 */

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
import {
  FABLE_CATALOG_MODELS,
  migration,
  NEW_SUPPORTED_MODELS,
  OLD_SUPPORTED_MODELS,
} from './index';

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

const PROVIDER_FIXTURE = {
  displayName: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  models: [
    {
      id: 'anthropic/claude-opus-4.8',
      displayName: 'Claude Opus 4.8',
      tags: ['chat', 'vision'],
      contextWindow: 1000000,
    },
  ],
};

const AGENT_FIXTURE = {
  agentKind: 'claude-code',
  authMode: 'managed',
  primaryBehavior: 'external-agent',
  supportedModels: [...OLD_SUPPORTED_MODELS],
  visibleInChat: true,
  i18n: {
    en: {
      displayName: 'Claude Code',
      description: 'Coding agent in an isolated sandbox',
    },
  },
};

describe('0.2.89/03 claude_code_fable_default', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tale-mig-ccfable-'));
    vi.stubEnv('TALE_CONFIG_DIR', dir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  const providerPath = () =>
    path.join(dir, 'org1', 'providers', 'openrouter.json');
  const agentPath = () =>
    path.join(dir, 'org1', 'agents', 'chat', 'claude-code.json');

  async function seed(
    provider: object | null = PROVIDER_FIXTURE,
    agent: object | null = AGENT_FIXTURE,
  ): Promise<void> {
    if (provider) {
      await mkdir(path.dirname(providerPath()), { recursive: true });
      await writeFile(providerPath(), JSON.stringify(provider, null, 2));
    }
    if (agent) {
      await mkdir(path.dirname(agentPath()), { recursive: true });
      await writeFile(agentPath(), JSON.stringify(agent, null, 2));
    }
  }

  async function readJson(p: string): Promise<Record<string, unknown>> {
    const raw = await readFileSafe(p);
    if (raw === null) throw new Error(`expected file at ${p}`);
    return JSON.parse(raw) as Record<string, unknown>;
  }

  it('up appends both Fable catalog entries and retargets the default pin', async () => {
    await seed();
    await migration.up(ctx, ORG, helpers);

    const provider = await readJson(providerPath());
    const ids = (provider.models as { id: string }[]).map((m) => m.id);
    expect(ids).toEqual([
      'anthropic/claude-opus-4.8',
      'anthropic/claude-fable-5',
      '~anthropic/claude-fable-latest',
    ]);

    const agent = await readJson(agentPath());
    expect(agent.supportedModels).toEqual(NEW_SUPPORTED_MODELS);
  });

  it('up is idempotent — a second run adds nothing and changes nothing', async () => {
    await seed();
    await migration.up(ctx, ORG, helpers);
    const providerAfterFirst = await readFileSafe(providerPath());
    const agentAfterFirst = await readFileSafe(agentPath());

    await migration.up(ctx, ORG, helpers);
    expect(await readFileSafe(providerPath())).toEqual(providerAfterFirst);
    expect(await readFileSafe(agentPath())).toEqual(agentAfterFirst);
  });

  it('up leaves an operator-edited pin untouched (still appends the catalog)', async () => {
    const edited = {
      ...AGENT_FIXTURE,
      supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
    };
    await seed(PROVIDER_FIXTURE, edited);
    await migration.up(ctx, ORG, helpers);

    const agent = await readJson(agentPath());
    expect(agent.supportedModels).toEqual([
      'openrouter:anthropic/claude-sonnet-4.6',
    ]);
    const provider = await readJson(providerPath());
    expect((provider.models as { id: string }[]).length).toBe(3);
  });

  it('up is a no-op for an org without an openrouter provider', async () => {
    await seed(null, AGENT_FIXTURE);
    await migration.up(ctx, ORG, helpers);

    expect(await readFileSafe(providerPath())).toBeNull();
    const agent = await readJson(agentPath());
    expect(agent.supportedModels).toEqual(OLD_SUPPORTED_MODELS);
  });

  it('down restores the old pin and removes exactly the entries up added', async () => {
    await seed();
    await migration.up(ctx, ORG, helpers);
    await migration.down(ctx, ORG, helpers);

    const provider = await readJson(providerPath());
    const ids = (provider.models as { id: string }[]).map((m) => m.id);
    expect(ids).toEqual(['anthropic/claude-opus-4.8']);

    const agent = await readJson(agentPath());
    expect(agent.supportedModels).toEqual(OLD_SUPPORTED_MODELS);
  });

  it('down keeps a Fable entry that does not match the exact added shape', async () => {
    // A cron-added entry (no qualityScore) — must survive down untouched.
    const cronAdded = {
      id: 'anthropic/claude-fable-5',
      displayName: 'Claude Fable 5',
      tags: ['chat', 'vision'],
      contextWindow: 1000000,
    };
    await seed(
      {
        ...PROVIDER_FIXTURE,
        models: [...PROVIDER_FIXTURE.models, cronAdded],
      },
      AGENT_FIXTURE,
    );
    await migration.down(ctx, ORG, helpers);

    const provider = await readJson(providerPath());
    const ids = (provider.models as { id: string }[]).map((m) => m.id);
    expect(ids).toContain('anthropic/claude-fable-5');
    expect(FABLE_CATALOG_MODELS.map((m) => m.id)).toContain(
      'anthropic/claude-fable-5',
    );
  });
});

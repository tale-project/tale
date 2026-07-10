// @vitest-environment node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, vi } from 'vitest';

import { readFileSafe } from '../../../../lib/file_io';
import { buildModules } from '../../../framework/test_helpers';
import {
  defineMigrationTest,
  type WorldHandle,
} from '../../../testing/harness.testkit';
import {
  FABLE_CATALOG_MODELS,
  NEW_SUPPORTED_MODELS,
  OLD_SUPPORTED_MODELS,
} from './migration';

// World-building imports the whole convex tree; under the fully parallel suite
// the default 5s budget flakes — and a timed-out ritual's zombie async work
// can then corrupt the file's later tests. Chain tests size timeouts likewise.
vi.setConfig({ testTimeout: 60_000 });

const DIR = 'migrations/versions/v0_2_89/03_claude_code_fable_default';

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

function providerPath(world: WorldHandle, slug: string): string {
  return path.join(world.configRoot, slug, 'providers', 'openrouter.json');
}
function agentPath(world: WorldHandle, slug: string): string {
  return path.join(
    world.configRoot,
    slug,
    'agents',
    'chat',
    'claude-code.json',
  );
}

async function readJson(p: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(p, 'utf-8')) as Record<string, unknown>;
}

function modelIds(provider: Record<string, unknown>): string[] {
  return (provider.models as { id: string }[]).map((m) => m.id);
}

// Harness ritual: real fleet up, handler idempotency over migrated state
// (second pass appends nothing, retargets nothing), and down restoring the
// seeded world — this migration is its own exact in-place inverse
// (snapshot: 'none'), so the digest equality proves the inverse precisely.
defineMigrationTest({
  id: '0.2.89/03_claude_code_fable_default',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seedFs(root, orgs) {
    // org1: the full path — provider catalog + shipped-default agent pin.
    const providerDir = path.join(root, orgs[0].slug, 'providers');
    const agentDir = path.join(root, orgs[0].slug, 'agents', 'chat');
    await mkdir(providerDir, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      path.join(providerDir, 'openrouter.json'),
      JSON.stringify(PROVIDER_FIXTURE, null, 2),
    );
    await writeFile(
      path.join(agentDir, 'claude-code.json'),
      JSON.stringify(AGENT_FIXTURE, null, 2),
    );
    // org2: an old-pin agent but NO openrouter provider — the org must be
    // skipped entirely (the new pin could never resolve).
    const org2AgentDir = path.join(root, orgs[1].slug, 'agents', 'chat');
    await mkdir(org2AgentDir, { recursive: true });
    await writeFile(
      path.join(org2AgentDir, 'claude-code.json'),
      JSON.stringify(AGENT_FIXTURE, null, 2),
    );
  },

  async expectUp(world) {
    const [org1, org2] = world.orgs;

    // Both Fable entries appended; the shipped-default pin retargeted.
    const provider = await readJson(providerPath(world, org1.slug));
    expect(modelIds(provider)).toEqual([
      'anthropic/claude-opus-4.8',
      'anthropic/claude-fable-5',
      '~anthropic/claude-fable-latest',
    ]);
    const agent = await readJson(agentPath(world, org1.slug));
    expect(agent.supportedModels).toEqual(NEW_SUPPORTED_MODELS);

    // org2 has no openrouter provider: no catalog appears, pin untouched.
    expect(await readFileSafe(providerPath(world, org2.slug))).toBeNull();
    const org2Agent = await readJson(agentPath(world, org2.slug));
    expect(org2Agent.supportedModels).toEqual(OLD_SUPPORTED_MODELS);
  },

  cases: {
    'up leaves an operator-edited pin untouched (still appends the catalog)':
      async (world) => {
        const edited = {
          ...AGENT_FIXTURE,
          supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
        };
        await writeFile(
          agentPath(world, world.orgs[0].slug),
          JSON.stringify(edited, null, 2),
        );
        await world.applyUpOnly();

        const agent = await readJson(agentPath(world, world.orgs[0].slug));
        expect(agent.supportedModels).toEqual([
          'openrouter:anthropic/claude-sonnet-4.6',
        ]);
        const provider = await readJson(
          providerPath(world, world.orgs[0].slug),
        );
        expect(modelIds(provider)).toHaveLength(3);
      },

    'down keeps a Fable entry that does not match the exact added shape':
      async (world) => {
        // A cron-added entry (no qualityScore) — must survive down untouched.
        const cronAdded = {
          id: 'anthropic/claude-fable-5',
          displayName: 'Claude Fable 5',
          tags: ['chat', 'vision'],
          contextWindow: 1000000,
        };
        await writeFile(
          providerPath(world, world.orgs[0].slug),
          JSON.stringify(
            {
              ...PROVIDER_FIXTURE,
              models: [...PROVIDER_FIXTURE.models, cronAdded],
            },
            null,
            2,
          ),
        );
        await world.applyUpOnly();
        await world.applyDownOnly();

        const provider = await readJson(
          providerPath(world, world.orgs[0].slug),
        );
        expect(modelIds(provider)).toContain('anthropic/claude-fable-5');
        expect(FABLE_CATALOG_MODELS.map((m) => m.id)).toContain(
          'anthropic/claude-fable-5',
        );
        // The exact-shape rolling alias `up` added was removed again.
        expect(modelIds(provider)).not.toContain(
          '~anthropic/claude-fable-latest',
        );
      },
  },
});

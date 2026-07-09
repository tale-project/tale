/**
 * Unit tests for the default-agent provisioner's provision-guard semantics —
 * in particular `reinstallMissing`: the explicit "Update built-in agents"
 * sync must heal a DELETED `agentInstallations` row of an autoInstall agent,
 * while background sweeps (no flag) keep respecting the never-reprovision
 * guard, and an existing (even disabled) row is never touched.
 *
 * Same direct-handler pattern as `organizations/builtin_sync.test.ts`: the
 * codegen surface is mocked so `internalAction(config)` returns the config,
 * and the walk runs against a real temp org dir.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
  internalAction: vi.fn((config) => config),
}));

vi.mock('../_generated/api', () => ({
  internal: {
    agents: {
      provision_defaults: {
        syncDefaultAgentInstallations: 'syncDefaultAgentInstallations',
      },
      provision_defaults_mutations: {
        getProvision: 'getProvision',
        recordProvision: 'recordProvision',
        hasAnyProvisionQuery: 'hasAnyProvisionQuery',
      },
      installations: {
        upsertInstallation: 'upsertInstallation',
        getInstallationInternal: 'getInstallationInternal',
      },
    },
  },
}));

// The rate limiter is only used by `ensureAgentsProvisioned`, not the sweep
// under test — stub it so the module import carries no component dependency.
vi.mock('../lib/rate_limiter', () => ({
  rateLimiter: { limit: vi.fn().mockResolvedValue({ ok: true }) },
}));

const { syncDefaultAgentInstallations } = await import('./provision_defaults');

type SweepArgs = {
  organizationId: string;
  orgSlug: string;
  attempt?: number;
  reinstallMissing?: boolean;
};
type ActionConfig = {
  handler: (
    ctx: never,
    args: SweepArgs,
  ) => Promise<{ provisioned: number; skipped: number; failed: number }>;
};
const sweep = (syncDefaultAgentInstallations as unknown as ActionConfig)
  .handler;

let configRoot: string;
let savedConfigDir: string | undefined;

/** Per-slug fixtures the mocked runQuery serves. */
let provisionRows: Record<string, { contentHash: string }>;
let installRows: Record<string, { enabled: boolean }>;

function createMockCtx() {
  const runQuery = vi.fn((fn: unknown, args: { agentSlug: string }) => {
    if (fn === 'getProvision') {
      return Promise.resolve(provisionRows[args.agentSlug] ?? null);
    }
    if (fn === 'getInstallationInternal') {
      return Promise.resolve(installRows[args.agentSlug] ?? null);
    }
    return Promise.resolve(null);
  });
  const runMutation = vi.fn().mockResolvedValue(null);
  return { runQuery, runMutation, scheduler: { runAfter: vi.fn() } };
}

async function writeAgent(
  relPath: string,
  config: Record<string, unknown>,
): Promise<void> {
  const abs = path.join(configRoot, 'acme', 'agents', relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(
    abs,
    JSON.stringify({
      displayName: 'x',
      systemInstructions: 'You are a test agent.',
      supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
      ...config,
    }),
    'utf-8',
  );
}

/** The upsertInstallation calls a sweep made, keyed by slug. */
function installedSlugs(ctx: ReturnType<typeof createMockCtx>): string[] {
  return ctx.runMutation.mock.calls
    .filter(([fn]) => fn === 'upsertInstallation')
    .map(([, args]) => (args as { agentSlug: string }).agentSlug);
}

beforeEach(async () => {
  vi.clearAllMocks();
  savedConfigDir = process.env.TALE_CONFIG_DIR;
  configRoot = await mkdtemp(path.join(tmpdir(), 'provision-defaults-'));
  process.env.TALE_CONFIG_DIR = configRoot;
  provisionRows = {};
  installRows = {};
});

afterEach(async () => {
  if (savedConfigDir === undefined) {
    delete process.env.TALE_CONFIG_DIR;
  } else {
    process.env.TALE_CONFIG_DIR = savedConfigDir;
  }
  await rm(configRoot, { recursive: true, force: true });
});

describe('syncDefaultAgentInstallations — provision guard', () => {
  it('installs an unprovisioned autoInstall agent and records the provision', async () => {
    await writeAgent('chat/assistant.json', {
      slug: 'assistant',
      metadata: { autoInstall: true },
    });
    await writeAgent('chat/claude-code.json', { slug: 'claude-code' });

    const ctx = createMockCtx();
    const result = await sweep(ctx as never, {
      organizationId: 'org1',
      orgSlug: 'acme',
    });

    // Only the autoInstall-flagged file installs; the other is catalog-only.
    expect(result).toEqual({ provisioned: 1, skipped: 0, failed: 0 });
    expect(installedSlugs(ctx)).toEqual(['assistant']);
  });

  it('background sweep never re-provisions a previously provisioned agent (deleted row stays deleted)', async () => {
    await writeAgent('chat/assistant.json', {
      slug: 'assistant',
      metadata: { autoInstall: true },
    });
    provisionRows['assistant'] = { contentHash: 'h1' };
    // No install row — the org deleted it after the original provision.

    const ctx = createMockCtx();
    const result = await sweep(ctx as never, {
      organizationId: 'org1',
      orgSlug: 'acme',
    });

    expect(result).toEqual({ provisioned: 0, skipped: 1, failed: 0 });
    expect(installedSlugs(ctx)).toEqual([]);
  });

  // Regression: "Update built-in agents" must restore an autoInstall agent
  // whose install row was deleted — the explicit sync is operator consent,
  // unlike the background sweep the guard exists for.
  it('reinstallMissing heals a provisioned agent whose install row was deleted', async () => {
    await writeAgent('chat/assistant.json', {
      slug: 'assistant',
      metadata: { autoInstall: true },
    });
    provisionRows['assistant'] = { contentHash: 'h1' };

    const ctx = createMockCtx();
    const result = await sweep(ctx as never, {
      organizationId: 'org1',
      orgSlug: 'acme',
      reinstallMissing: true,
    });

    expect(result).toEqual({ provisioned: 1, skipped: 0, failed: 0 });
    expect(installedSlugs(ctx)).toEqual(['assistant']);
  });

  it('reinstallMissing leaves an existing (disabled) install row untouched', async () => {
    await writeAgent('chat/assistant.json', {
      slug: 'assistant',
      metadata: { autoInstall: true },
    });
    provisionRows['assistant'] = { contentHash: 'h1' };
    installRows['assistant'] = { enabled: false };

    const ctx = createMockCtx();
    const result = await sweep(ctx as never, {
      organizationId: 'org1',
      orgSlug: 'acme',
      reinstallMissing: true,
    });

    expect(result).toEqual({ provisioned: 0, skipped: 1, failed: 0 });
    expect(installedSlugs(ctx)).toEqual([]);
  });
});

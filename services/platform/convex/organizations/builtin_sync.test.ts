import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the codegen surface so `action(config)` returns the config itself —
// that exposes `.handler` for direct invocation (same pattern as
// scaffold.test.ts / agents/file_actions.test.ts).
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
    },
    workflows: {
      provision_defaults: {
        syncDefaultWorkflowInstallations: 'syncDefaultWorkflowInstallations',
      },
    },
    automations: {
      install_mutations: {
        listAutomationInstallationsInternal:
          'listAutomationInstallationsInternal',
      },
    },
  },
}));

// The auth gate and the two heavy dependency graphs (agents/internal_actions,
// automations/install_actions) are unit-mocked — the sync's own fs logic is
// what these tests exercise against real temp dirs.
const mockRequireDeveloperSettingsAccessById = vi.fn();
vi.mock('../providers/auth', () => ({
  requireDeveloperSettingsAccessById: (...args: unknown[]) =>
    mockRequireDeveloperSettingsAccessById(...args),
}));

const mockInvalidateAgentListCache = vi.fn();
vi.mock('../agents/internal_actions', () => ({
  invalidateAgentListCache: (...args: unknown[]) =>
    mockInvalidateAgentListCache(...args),
}));

const mockPrepareInstall = vi.fn();
const mockEnsureOrgResources = vi.fn();
vi.mock('../automations/install_actions', () => ({
  prepareInstall: (...args: unknown[]) => mockPrepareInstall(...args),
  ensureOrgResources: (...args: unknown[]) => mockEnsureOrgResources(...args),
}));

const mockInvalidateSkillContextCache = vi.fn();
vi.mock('../lib/agent_chat/skill_context_cache', () => ({
  invalidateSkillContextCache: (...args: unknown[]) =>
    mockInvalidateSkillContextCache(...args),
}));

const { syncDomainFromBuiltin } = await import('./builtin_sync');

type ActionConfig = {
  handler: (
    ctx: never,
    args: {
      organizationId: string;
      domain:
        | 'agents'
        | 'workflows'
        | 'integrations'
        | 'automations'
        | 'skills';
    },
  ) => Promise<{ updated: number; backedUp: number }>;
};
const syncHandler = (syncDomainFromBuiltin as unknown as ActionConfig).handler;

const ENV_KEYS = ['TALE_CONFIG_DIR', 'TALE_CONFIG_BUILTIN_DIR'] as const;

let configRoot: string;
let catalogRoot: string;
const savedEnv: Record<string, string | undefined> = {};

function createMockCtx() {
  return {
    scheduler: { runAfter: vi.fn() },
    runQuery: vi.fn().mockResolvedValue([]),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  configRoot = await mkdtemp(path.join(tmpdir(), 'builtin-sync-cfg-'));
  catalogRoot = await mkdtemp(path.join(tmpdir(), 'builtin-sync-cat-'));
  process.env.TALE_CONFIG_DIR = configRoot;
  process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;
  mockRequireDeveloperSettingsAccessById.mockResolvedValue({
    orgSlug: 'acme',
  });
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedEnv[k];
    }
  }
  await rm(configRoot, { recursive: true, force: true });
  await rm(catalogRoot, { recursive: true, force: true });
});

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

function catSrc(...parts: string[]): string {
  return path.join(catalogRoot, ...parts);
}

// Minimal but schema-VALID agent catalog fixture. `seedDomain` (invoked by
// `syncDomainFromBuiltin` for the actual overwrite, via `writeFileFromCatalog`)
// now validates each `.json` catalog file against its domain schema before
// writing it (Phase 3 runtime guard) — a throwaway `{"slug":"x"}` fixture
// would silently be skipped instead of copied. `extra` carries the test's own
// marker fields (`slug`, `v`, ...) alongside the fields agentJsonSchema
// requires; unknown keys are stripped by the schema on parse but this helper
// only feeds the raw string through a validity CHECK — the exact string is
// what lands on disk, so the marker fields still round-trip.
function agentJson(extra: Record<string, unknown>): string {
  return JSON.stringify({
    displayName: 'x',
    systemInstructions: 'You are a test agent.',
    supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
    ...extra,
  });
}

function orgDst(...parts: string[]): string {
  return path.join(configRoot, 'acme', ...parts);
}

describe('syncDomainFromBuiltin — tree domains (agents/workflows)', () => {
  it('overwrites changed builtin agents, backs the previous version into the entry history, and counts', async () => {
    await writeText(
      catSrc('agents', 'chat', 'assistant.json'),
      agentJson({ slug: 'assistant', v: 'new' }),
    );
    await writeText(
      catSrc('agents', 'coder.json'),
      agentJson({ slug: 'coder' }),
    );
    // Org state: user-edited builtin, an untouched builtin, a user-added agent.
    // The org-side files are never re-validated by the sync (only the
    // catalog source is), so they can stay throwaway marker strings.
    await writeText(
      orgDst('agents', 'chat', 'assistant.json'),
      '{"slug":"assistant","v":"user-edited"}',
    );
    await writeText(
      orgDst('agents', 'coder.json'),
      agentJson({ slug: 'coder' }),
    );
    await writeText(orgDst('agents', 'my-own.json'), '{"slug":"my-own"}');

    const ctx = createMockCtx();
    const result = await syncHandler(ctx as never, {
      organizationId: 'org1',
      domain: 'agents',
    });

    // One changed entry; `coder` was identical, `my-own` is org-authored.
    expect(result).toEqual({ updated: 1, backedUp: 1 });
    expect(
      await readFile(orgDst('agents', 'chat', 'assistant.json'), 'utf-8'),
    ).toBe(agentJson({ slug: 'assistant', v: 'new' }));
    expect(existsSync(orgDst('agents', 'my-own.json'))).toBe(true);

    // The previous version landed in the SLUG-keyed history trail the
    // existing restore UI reads.
    const historyDir = orgDst('agents', '.history', 'assistant');
    const entries = await readdir(historyDir);
    expect(entries).toHaveLength(1);
    expect(
      await readFile(path.join(historyDir, entries[0] ?? ''), 'utf-8'),
    ).toBe('{"slug":"assistant","v":"user-edited"}');

    // Post-sync hooks: cache drop + default-agent provisioner scheduled with
    // `reinstallMissing` (the explicit sync is consent to heal deleted rows).
    expect(mockInvalidateAgentListCache).toHaveBeenCalledWith('acme');
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      'syncDefaultAgentInstallations',
      { organizationId: 'org1', orgSlug: 'acme', reinstallMissing: true },
    );
  });

  it('adds new builtin entries without a backup and reports zero when nothing changed', async () => {
    await writeText(
      catSrc('agents', 'newcomer.json'),
      agentJson({ slug: 'newcomer' }),
    );

    const ctx = createMockCtx();
    const first = await syncHandler(ctx as never, {
      organizationId: 'org1',
      domain: 'agents',
    });
    expect(first).toEqual({ updated: 1, backedUp: 0 });
    expect(existsSync(orgDst('agents', 'newcomer.json'))).toBe(true);
    expect(existsSync(orgDst('agents', '.history'))).toBe(false);

    // Second run: already in sync — no writes, no file hooks. The
    // provisioner is STILL scheduled (with `reinstallMissing`): the explicit
    // sync doubles as the recovery path for a deleted install row, which is
    // invisible to the file comparison.
    const ctx2 = createMockCtx();
    const second = await syncHandler(ctx2 as never, {
      organizationId: 'org1',
      domain: 'agents',
    });
    expect(second).toEqual({ updated: 0, backedUp: 0 });
    expect(ctx2.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      'syncDefaultAgentInstallations',
      { organizationId: 'org1', orgSlug: 'acme', reinstallMissing: true },
    );
    expect(mockInvalidateAgentListCache).toHaveBeenCalledTimes(1);
  });

  it('preserves org-side secrets and existing history trails through an agents sync', async () => {
    await writeText(
      catSrc('agents', 'shipped.json'),
      agentJson({ slug: 'shipped', v: 2 }),
    );
    await writeText(
      orgDst('agents', 'shipped.json'),
      '{"slug":"shipped","v":1}',
    );
    await writeText(orgDst('agents', 'x.secrets.json'), '{"key":"keep"}');
    await writeText(
      orgDst('agents', '.history', 'other', '1.json'),
      '{"old":1}',
    );

    await syncHandler(createMockCtx() as never, {
      organizationId: 'org1',
      domain: 'agents',
    });

    expect(await readFile(orgDst('agents', 'x.secrets.json'), 'utf-8')).toBe(
      '{"key":"keep"}',
    );
    expect(existsSync(orgDst('agents', '.history', 'other', '1.json'))).toBe(
      true,
    );
  });

  it('backs a changed workflow into the flattened-slug history and schedules the workflow provisioner', async () => {
    await writeText(
      catSrc('workflows', 'github', 'sync.json'),
      '{"name":"new"}',
    );
    await writeText(
      orgDst('workflows', 'github', 'sync.json'),
      '{"name":"old"}',
    );

    const ctx = createMockCtx();
    const result = await syncHandler(ctx as never, {
      organizationId: 'org1',
      domain: 'workflows',
    });

    expect(result).toEqual({ updated: 1, backedUp: 1 });
    expect(
      await readFile(orgDst('workflows', 'github', 'sync.json'), 'utf-8'),
    ).toBe('{"name":"new"}');
    const historyDir = orgDst('workflows', '.history', 'github__sync');
    const entries = await readdir(historyDir);
    expect(entries).toHaveLength(1);
    expect(
      await readFile(path.join(historyDir, entries[0] ?? ''), 'utf-8'),
    ).toBe('{"name":"old"}');
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      'syncDefaultWorkflowInstallations',
      { organizationId: 'org1', orgSlug: 'acme' },
    );
  });
});

describe('syncDomainFromBuiltin — bundle domains (integrations/automations/skills)', () => {
  it('syncs the skills bundle domain and invalidates the org skill cache', async () => {
    await writeText(
      catSrc('skills', 'browse-web', 'SKILL.md'),
      '---\nname: browse-web\ndescription: New\n---\nnew body\n',
    );
    await writeText(
      orgDst('skills', 'browse-web', 'SKILL.md'),
      '---\nname: browse-web\ndescription: Old\n---\nold body\n',
    );

    const result = await syncHandler(createMockCtx() as never, {
      organizationId: 'org1',
      domain: 'skills',
    });

    expect(result).toEqual({ updated: 1, backedUp: 1 });
    expect(
      await readFile(orgDst('skills', 'browse-web', 'SKILL.md'), 'utf-8'),
    ).toContain('description: New');
    // The whole previous bundle is preserved under the domain-root history.
    const stamps = await readdir(orgDst('skills', '.history', 'browse-web'));
    expect(stamps).toHaveLength(1);
    // The chat runtime's skill snapshot cache drops so the next send picks
    // up the refreshed bundles (same invalidation the upload path runs).
    expect(mockInvalidateSkillContextCache).toHaveBeenCalledWith('acme');
  });

  it('replaces only changed bundles, backing the whole previous bundle into the domain history', async () => {
    await writeText(
      catSrc('integrations', 'github', 'config.json'),
      '{"v":"new"}',
    );
    await writeText(
      catSrc('integrations', 'slack', 'config.json'),
      '{"v":"same"}',
    );
    // Org state: changed github bundle (edit + a user-added extra file),
    // unchanged slack bundle with an internal history trail.
    await writeText(
      orgDst('integrations', 'github', 'config.json'),
      '{"v":"old"}',
    );
    await writeText(orgDst('integrations', 'github', 'extra.txt'), 'user file');
    await writeText(
      orgDst('integrations', 'slack', 'config.json'),
      '{"v":"same"}',
    );
    await writeText(
      orgDst('integrations', 'slack', '.history', 'trail.json'),
      '{"trail":1}',
    );

    const result = await syncHandler(createMockCtx() as never, {
      organizationId: 'org1',
      domain: 'integrations',
    });

    expect(result).toEqual({ updated: 1, backedUp: 1 });
    // github: replaced whole — new config, user extra gone.
    expect(
      await readFile(orgDst('integrations', 'github', 'config.json'), 'utf-8'),
    ).toBe('{"v":"new"}');
    expect(existsSync(orgDst('integrations', 'github', 'extra.txt'))).toBe(
      false,
    );
    // slack: untouched, internal history survives.
    expect(
      existsSync(orgDst('integrations', 'slack', '.history', 'trail.json')),
    ).toBe(true);

    // The previous github bundle (including the extra file) is preserved
    // under the domain-root history.
    const backupRoot = orgDst('integrations', '.history', 'github');
    const stamps = await readdir(backupRoot);
    expect(stamps).toHaveLength(1);
    const backupDir = path.join(backupRoot, stamps[0] ?? '');
    expect(await readFile(path.join(backupDir, 'config.json'), 'utf-8')).toBe(
      '{"v":"old"}',
    );
    expect(await readFile(path.join(backupDir, 'extra.txt'), 'utf-8')).toBe(
      'user file',
    );
  });

  it('installs a brand-new builtin bundle without a backup', async () => {
    await writeText(catSrc('integrations', 'linear', 'config.json'), '{"v":1}');

    const result = await syncHandler(createMockCtx() as never, {
      organizationId: 'org1',
      domain: 'integrations',
    });

    expect(result).toEqual({ updated: 1, backedUp: 0 });
    expect(existsSync(orgDst('integrations', 'linear', 'config.json'))).toBe(
      true,
    );
    expect(existsSync(orgDst('integrations', '.history'))).toBe(false);
  });

  it('re-runs the app install pipeline only for installed apps whose bundle changed', async () => {
    await writeText(
      catSrc('automations', 'issue-desk', 'automation.json'),
      '{"v":"new"}',
    );
    await writeText(
      catSrc('automations', 'crm', 'automation.json'),
      '{"v":"same"}',
    );
    await writeText(
      orgDst('automations', 'issue-desk', 'automation.json'),
      '{"v":"old"}',
    );
    await writeText(
      orgDst('automations', 'crm', 'automation.json'),
      '{"v":"same"}',
    );
    // A privately-uploaded app with no builtin counterpart stays untouched.
    await writeText(
      orgDst('automations', 'private-app', 'automation.json'),
      '{"mine":1}',
    );

    const ctx = createMockCtx();
    // Both catalog apps are installed; `private-app` too.
    ctx.runQuery.mockResolvedValue(['issue-desk', 'crm', 'private-app']);
    mockPrepareInstall.mockResolvedValue({ manifest: {} });

    const result = await syncHandler(ctx as never, {
      organizationId: 'org1',
      domain: 'automations',
    });

    expect(result).toEqual({ updated: 1, backedUp: 1 });
    expect(
      await readFile(
        orgDst('automations', 'issue-desk', 'automation.json'),
        'utf-8',
      ),
    ).toBe('{"v":"new"}');
    expect(
      existsSync(orgDst('automations', 'private-app', 'automation.json')),
    ).toBe(true);

    // Reinstall pipeline ran once, for the changed installed app only.
    expect(mockPrepareInstall).toHaveBeenCalledTimes(1);
    expect(mockPrepareInstall).toHaveBeenCalledWith(ctx, 'org1', 'issue-desk');
    expect(mockEnsureOrgResources).toHaveBeenCalledTimes(1);
  });

  it('automations sync: refreshes a changed bundle from the catalog', async () => {
    // automation.json changed → the whole bundle is replaced from the catalog.
    await writeText(
      catSrc('automations', 'issue-desk', 'automation.json'),
      '{"v":"new"}',
    );
    await writeText(
      orgDst('automations', 'issue-desk', 'automation.json'),
      '{"v":"old"}',
    );

    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue(['issue-desk']);
    mockPrepareInstall.mockResolvedValue({ manifest: {} });

    const result = await syncHandler(ctx as never, {
      organizationId: 'org1',
      domain: 'automations',
    });

    expect(result).toEqual({ updated: 1, backedUp: 1 });
    // automation.json (which carries the inline workflow) refreshed from the catalog.
    expect(
      await readFile(
        orgDst('automations', 'issue-desk', 'automation.json'),
        'utf-8',
      ),
    ).toBe('{"v":"new"}');
  });

  it('a failing app reinstall does not fail the sync of the files', async () => {
    await writeText(
      catSrc('automations', 'issue-desk', 'automation.json'),
      '{"v":"new"}',
    );
    await writeText(
      orgDst('automations', 'issue-desk', 'automation.json'),
      '{"v":"old"}',
    );

    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue(['issue-desk']);
    mockPrepareInstall.mockRejectedValue(new Error('manifest read failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = await syncHandler(ctx as never, {
        organizationId: 'org1',
        domain: 'automations',
      });
      expect(result).toEqual({ updated: 1, backedUp: 1 });
      expect(
        await readFile(
          orgDst('automations', 'issue-desk', 'automation.json'),
          'utf-8',
        ),
      ).toBe('{"v":"new"}');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('syncDomainFromBuiltin — guards', () => {
  it('throws when the builtin catalog dir is not configured', async () => {
    delete process.env.TALE_CONFIG_BUILTIN_DIR;
    await expect(
      syncHandler(createMockCtx() as never, {
        organizationId: 'org1',
        domain: 'agents',
      }),
    ).rejects.toThrow(/TALE_CONFIG_BUILTIN_DIR/);
  });

  it('requires developer-settings access before touching any file', async () => {
    mockRequireDeveloperSettingsAccessById.mockRejectedValue(
      new Error('FORBIDDEN_DEVELOPER_SETTINGS'),
    );
    await writeText(catSrc('agents', 'shipped.json'), '{"slug":"shipped"}');

    await expect(
      syncHandler(createMockCtx() as never, {
        organizationId: 'org1',
        domain: 'agents',
      }),
    ).rejects.toThrow('FORBIDDEN_DEVELOPER_SETTINGS');
    expect(existsSync(orgDst('agents', 'shipped.json'))).toBe(false);
  });
});

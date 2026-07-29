import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same codegen-surface mock as scaffold.test.ts: `action(config)` returns the
// config itself so `.handler` is directly invokable. `internalAction` is
// needed too — actions.ts imports scaffold.ts, which registers one.
vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
  internalAction: vi.fn((config) => config),
}));

// retryProvisioning dereferences three scheduler targets from the generated
// `internal` tree (automation/agent installs are offline stubs today —
// see actions.ts). Sentinel strings are enough here — this suite asserts the
// scheduling calls; the provisioners themselves carry their own suites.
vi.mock('../_generated/api', () => ({
  internal: {
    lib: {
      config_cache: {
        sync_org: { syncOrgConfigCaches: 'syncOrgConfigCaches' },
      },
    },
    provisioning: {
      provision_default_automations: {
        provisionDefaultAutomations: 'provisionDefaultAutomations',
      },
      seed_starter: { seedStarterContent: 'seedStarterContent' },
    },
  },
}));

vi.mock('./auth', () => ({
  requireDeveloperSettingsAccessById: vi.fn(),
}));

const { requireDeveloperSettingsAccessById } = await import('./auth');
const authMock = vi.mocked(requireDeveloperSettingsAccessById);

const { getProvisioningStatus, retryProvisioning } = await import('./actions');

type SchedulerCtx = {
  scheduler: { runAfter: ReturnType<typeof vi.fn> };
};
type StatusAction = {
  handler: (
    ctx: SchedulerCtx,
    args: { organizationId: string },
  ) => Promise<{ provisioned: boolean; missingDomains: string[] }>;
};
type RetryAction = {
  handler: (
    ctx: SchedulerCtx,
    args: { organizationId: string },
  ) => Promise<{ ok: boolean; failedDomains: string[] }>;
};
const statusHandler = (getProvisioningStatus as unknown as StatusAction)
  .handler;
const retryHandler = (retryProvisioning as unknown as RetryAction).handler;

// Same env ritual scaffold.ts itself expects — org-first needs only the two
// roots, but save/restore the legacy per-domain keys defensively too.
const ENV_KEYS = [
  'TALE_CONFIG_DIR',
  'TALE_CONFIG_BUILTIN_DIR',
  'AGENTS_DIR',
  'WORKFLOWS_DIR',
  'PROVIDERS_DIR',
  'INTEGRATIONS_DIR',
  'SKILLS_DIR',
] as const;

let configRoot: string;
let catalogRoot: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  configRoot = await mkdtemp(path.join(tmpdir(), 'retry-cfg-'));
  catalogRoot = await mkdtemp(path.join(tmpdir(), 'retry-cat-'));
  process.env.TALE_CONFIG_DIR = configRoot;
  process.env.TALE_CONFIG_BUILTIN_DIR = catalogRoot;

  vi.clearAllMocks();
  authMock.mockResolvedValue({
    orgId: 'org-1',
    orgSlug: 'acme',
    userId: 'user-1',
    member: { _id: 'member-1', role: 'owner' },
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

function orgDst(orgSlug: string, ...parts: string[]): string {
  return path.join(configRoot, orgSlug, ...parts);
}

// A real builtin catalog ships a dir for every scaffolded domain. The
// interim minimal registry only has one (`governance`) — without it,
// seedDomain's ENOENT-degrade returns ok:true-with-nothing-seeded (see
// scaffold.ts), which would make every fixture below invisible to the probe.
async function ensureCatalogDomainDirs(): Promise<void> {
  const { CONFIG_DOMAINS } = await import('../../lib/shared/config/registry');
  for (const domain of CONFIG_DOMAINS) {
    if (domain.scaffoldKind) {
      await mkdir(catSrc(domain.name), { recursive: true });
    }
  }
}

function makeCtx(): SchedulerCtx {
  return { scheduler: { runAfter: vi.fn() } };
}

// login_policy's schema defaults every field, so `{}` is a schema-valid
// governance catalog file (kebab filename: `login-policy.json`) — the
// scaffolder now validates each `.json` catalog file against its domain's
// `v8Sync` schema (when the filename maps to a key) before writing it, so a
// throwaway `{"name":"x"}` fixture would silently be skipped instead of
// copied. Mirrors the schemas' own test fixtures (governance.test.ts).
const VALID_LOGIN_POLICY_JSON = '{}';

describe('getProvisioningStatus', () => {
  it('keeps a genuinely missing domain red: catalog has seedable files, org dir has none', async () => {
    await ensureCatalogDomainDirs();
    await writeText(
      catSrc('governance', 'login-policy.json'),
      VALID_LOGIN_POLICY_JSON,
    );

    const result = await statusHandler(makeCtx(), { organizationId: 'org-1' });

    expect(result).toEqual({
      provisioned: false,
      missingDomains: ['governance'],
    });
  });
});

describe('retryProvisioning', () => {
  it('repairs an unprovisioned org and earns ok:true, scheduling the post-scaffold provisioners', async () => {
    await ensureCatalogDomainDirs();
    await writeText(
      catSrc('governance', 'login-policy.json'),
      VALID_LOGIN_POLICY_JSON,
    );

    const ctx = makeCtx();
    const result = await retryHandler(ctx, { organizationId: 'org-1' });

    expect(authMock).toHaveBeenCalledWith(ctx, 'org-1');
    expect(existsSync(orgDst('acme', 'governance', 'login-policy.json'))).toBe(
      true,
    );
    expect(result).toEqual({ ok: true, failedDomains: [] });
    // Config caches, automation packs, starter content.
    // Agent installs stay a chat-rebuild stub (not scheduled).
    expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(3);
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      'syncOrgConfigCaches',
      { organizationId: 'org-1' },
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      'provisionDefaultAutomations',
      { organizationId: 'org-1', orgSlug: 'acme' },
    );
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      10_000,
      'seedStarterContent',
      { organizationId: 'org-1' },
    );
  });

  it('does NOT report ok while the post-retry probe still lists missing domains (#2676)', async () => {
    await ensureCatalogDomainDirs();
    // A flat domain whose catalog dir holds only a stray subdir: the probe
    // counts it seedable (a named non-dot entry), but flat-mode copyTree
    // skips subdirs — the per-domain seed "succeeds" having copied nothing,
    // and the domain stays missing. The old code returned ok:true here and
    // the UI toasted success while the banner persisted.
    await writeText(
      catSrc('governance', 'stray', 'nested.json'),
      VALID_LOGIN_POLICY_JSON,
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = await retryHandler(makeCtx(), {
        organizationId: 'org-1',
      });

      expect(result.ok).toBe(false);
      expect(result.failedDomains).toEqual(['governance']);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('propagates an authorization failure without scheduling anything', async () => {
    authMock.mockRejectedValue(new Error('developer settings access required'));

    const ctx = makeCtx();
    await expect(
      retryHandler(ctx, { organizationId: 'org-1' }),
    ).rejects.toThrow('developer settings access required');
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });
});

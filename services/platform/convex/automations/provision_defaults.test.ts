/**
 * Unit tests for the default-automation provisioner's guard semantics: an
 * `autoInstall: true` org-scoped automation is installed exactly once per org
 * (tracked in `wfDefaultProvisions` under the automation slug), a previously
 * provisioned automation is never re-installed behind the org's back, a
 * project-scoped automation can never auto-install, a bundle aggregate is
 * skipped, and a still-copying scaffold triggers a bounded self-retry.
 *
 * Same direct-handler pattern as `agents/provision_defaults.test.ts`: the
 * codegen surface is mocked so `internalAction(config)` returns the config,
 * the install pipeline halves are mocked, and the catalog walk runs against a
 * real temp org dir.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
  internalAction: vi.fn((config) => config),
}));

vi.mock('../_generated/api', () => ({
  internal: {
    automations: {
      provision_defaults: {
        syncDefaultAutomationInstallations:
          'syncDefaultAutomationInstallations',
      },
    },
    workflows: {
      provision_defaults_mutations: {
        getProvision: 'getProvision',
        recordProvision: 'recordProvision',
      },
    },
  },
}));

// The ONE shared install pipeline is exercised by install_actions.test.ts —
// here it is mocked so this suite proves only the provisioner's walk + guard.
const mockPrepareInstallAs = vi.fn();
const mockEnsureOrgResources = vi.fn();
vi.mock('./install_actions', () => ({
  prepareInstallAs: (...args: unknown[]) => mockPrepareInstallAs(...args),
  ensureOrgResources: (...args: unknown[]) => mockEnsureOrgResources(...args),
}));

const mockReadBundleManifest = vi.fn();
vi.mock('./install_fs', () => ({
  readBundleManifest: (...args: unknown[]) => mockReadBundleManifest(...args),
}));

const { syncDefaultAutomationInstallations } =
  await import('./provision_defaults');

type SweepArgs = {
  organizationId: string;
  orgSlug: string;
  attempt?: number;
};
type ActionConfig = {
  handler: (
    ctx: never,
    args: SweepArgs,
  ) => Promise<{ provisioned: number; skipped: number; failed: number }>;
};
const sweep = (syncDefaultAutomationInstallations as unknown as ActionConfig)
  .handler;

let configRoot: string;
let savedConfigDir: string | undefined;

/** Per-slug manifests the mocked `prepareInstallAs` serves. */
let manifests: Record<string, Record<string, unknown>>;
/** Per-slug `wfDefaultProvisions` rows the mocked runQuery serves. */
let provisionRows: Record<string, { contentHash: string }>;

function createMockCtx() {
  const runQuery = vi.fn((fn: unknown, args: { workflowSlug: string }) => {
    if (fn === 'getProvision') {
      return Promise.resolve(provisionRows[args.workflowSlug] ?? null);
    }
    return Promise.resolve(null);
  });
  const runMutation = vi.fn().mockResolvedValue(null);
  return { runQuery, runMutation, scheduler: { runAfter: vi.fn() } };
}

/** Seed one automation bundle dir in the temp org catalog. */
async function writeAutomationDir(slug: string): Promise<void> {
  await mkdir(path.join(configRoot, 'acme', 'automations', slug), {
    recursive: true,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  savedConfigDir = process.env.TALE_CONFIG_DIR;
  configRoot = await mkdtemp(path.join(tmpdir(), 'automation-provision-'));
  process.env.TALE_CONFIG_DIR = configRoot;
  manifests = {};
  provisionRows = {};
  mockReadBundleManifest.mockResolvedValue(null);
  mockPrepareInstallAs.mockImplementation(
    (orgSlug: string, slug: string, installedBy: string) => {
      const manifest = manifests[slug];
      if (!manifest) throw new Error(`no manifest fixture for "${slug}"`);
      return Promise.resolve({ orgSlug, installedBy, manifest });
    },
  );
});

afterEach(async () => {
  if (savedConfigDir === undefined) {
    delete process.env.TALE_CONFIG_DIR;
  } else {
    process.env.TALE_CONFIG_DIR = savedConfigDir;
  }
  await rm(configRoot, { recursive: true, force: true });
});

describe('syncDefaultAutomationInstallations — provision guard', () => {
  it('installs an unprovisioned autoInstall org automation and records the provision', async () => {
    await writeAutomationDir('task-ops');
    await writeAutomationDir('crm'); // catalog-only, no autoInstall
    manifests['task-ops'] = { name: 'Task Ops', autoInstall: true };
    manifests['crm'] = { name: 'CRM' };

    const ctx = createMockCtx();
    const result = await sweep(ctx as never, {
      organizationId: 'org1',
      orgSlug: 'acme',
    });

    expect(result).toEqual({ provisioned: 1, skipped: 0, failed: 0 });
    // The ONE shared install pipeline ran, as system, for the flagged slug only.
    expect(mockPrepareInstallAs).toHaveBeenCalledWith(
      'acme',
      'task-ops',
      'system',
    );
    expect(mockEnsureOrgResources).toHaveBeenCalledTimes(1);
    expect(mockEnsureOrgResources).toHaveBeenCalledWith(
      ctx,
      'org1',
      'task-ops',
      expect.objectContaining({ orgSlug: 'acme', installedBy: 'system' }),
    );
    // …and the provision was recorded so it never re-runs behind the org.
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'recordProvision',
      expect.objectContaining({
        organizationId: 'org1',
        workflowSlug: 'task-ops',
        contentHash: expect.any(String),
      }),
    );
  });

  it('never re-provisions a previously provisioned automation (uninstall sticks)', async () => {
    await writeAutomationDir('task-ops');
    manifests['task-ops'] = { name: 'Task Ops', autoInstall: true };
    provisionRows['task-ops'] = { contentHash: 'h1' };

    const ctx = createMockCtx();
    const result = await sweep(ctx as never, {
      organizationId: 'org1',
      orgSlug: 'acme',
    });

    expect(result).toEqual({ provisioned: 0, skipped: 1, failed: 0 });
    expect(mockEnsureOrgResources).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('ignores autoInstall on a project-scoped automation (no default binding exists)', async () => {
    await writeAutomationDir('triage');
    manifests['triage'] = {
      name: 'Triage',
      autoInstall: true,
      scope: 'project',
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const ctx = createMockCtx();
      const result = await sweep(ctx as never, {
        organizationId: 'org1',
        orgSlug: 'acme',
      });

      expect(result).toEqual({ provisioned: 0, skipped: 0, failed: 0 });
      expect(mockEnsureOrgResources).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ignoring autoInstall'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('skips a bundle aggregate without reading an automation manifest', async () => {
    await writeAutomationDir('mega-bundle');
    mockReadBundleManifest.mockResolvedValue({ name: 'Mega' });

    const ctx = createMockCtx();
    const result = await sweep(ctx as never, {
      organizationId: 'org1',
      orgSlug: 'acme',
    });

    expect(result).toEqual({ provisioned: 0, skipped: 0, failed: 0 });
    expect(mockPrepareInstallAs).not.toHaveBeenCalled();
  });

  it('schedules a bounded self-retry while the scaffold has not copied the dir yet', async () => {
    // No org automations dir at all — readdir throws.
    const ctx = createMockCtx();
    const result = await sweep(ctx as never, {
      organizationId: 'org1',
      orgSlug: 'acme',
    });

    expect(result).toEqual({ provisioned: 0, skipped: 0, failed: 0 });
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      30_000,
      'syncDefaultAutomationInstallations',
      { organizationId: 'org1', orgSlug: 'acme', attempt: 2 },
    );

    // Final attempt: gives up quietly instead of re-scheduling.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ctx3 = createMockCtx();
      await sweep(ctx3 as never, {
        organizationId: 'org1',
        orgSlug: 'acme',
        attempt: 3,
      });
      expect(ctx3.scheduler.runAfter).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('one failing automation is counted and does not abort the sweep of the others', async () => {
    await writeAutomationDir('broken');
    await writeAutomationDir('task-ops');
    manifests['task-ops'] = { name: 'Task Ops', autoInstall: true };
    // 'broken' has no manifest fixture → mocked prepareInstallAs throws.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const ctx = createMockCtx();
      const result = await sweep(ctx as never, {
        organizationId: 'org1',
        orgSlug: 'acme',
      });

      expect(result).toEqual({ provisioned: 1, skipped: 0, failed: 1 });
      expect(mockEnsureOrgResources).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `rebindBundledAutomations` clones every automation bound to an integration onto
 * a duplicate's new slug. Two properties matter beyond the manifest rewrite
 * (pinned separately in rebind_manifest.test.ts):
 *
 *  1. the clone installs with NO cron — a duplicate's credential is blank until
 *     an operator fills it in, and a schedule provisioned now would fire a
 *     guaranteed-failing run on every tick until then (forever, if the duplicate
 *     is abandoned). The integration's reconnect cascade provisions it on first
 *     successful connect instead;
 *  2. a bundle dir written but not installed is swept on failure — the teardown
 *     finds automations by INSTALL ROW, so an uninstalled dir would be invisible
 *     to it and left behind.
 *
 * The filesystem and the automation-dir resolvers are mocked; the real manifest
 * is read off disk so the schema re-validation step runs against real data.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const IMAP_MANIFEST = path.join(
  REPO_ROOT,
  'builtin-configs/automations/imap-smtp/sync-emails/automation.json',
);
const MANIFEST_JSON = readFileSync(IMAP_MANIFEST, 'utf-8');

const mockRm = vi.fn().mockResolvedValue(undefined);
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(MANIFEST_JSON),
  rm: (...args: unknown[]) => mockRm(...args),
}));

vi.mock('../_generated/api', () => ({
  internal: {
    automations: {
      install_mutations: {
        listInstallationsRequiringIntegrationInternal: 'listBound',
        listAutomationInstallationsInternal: 'listInstalled',
      },
      install_actions: { installAutomationInternal: 'install' },
    },
  },
}));

vi.mock('./file_utils', () => ({
  listAutomationSlugs: vi.fn().mockResolvedValue([]),
  resolveAutomationDir: (orgSlug: string, slug: string) =>
    `/cfg/${orgSlug}/automations/${slug}`,
  resolveAutomationsDir: (orgSlug: string) => `/cfg/${orgSlug}/automations`,
  resolveCatalogAutomationsDir: () => '/builtin/automations',
}));

vi.mock('./install_fs', () => ({
  resolveAutomationBundleSourceDir: vi
    .fn()
    .mockResolvedValue('/builtin/automations/imap-smtp/sync-emails'),
}));

vi.mock('../lib/file_io', () => ({
  atomicWrite: vi.fn().mockResolvedValue(undefined),
  atomicWriteBuffer: vi.fn().mockResolvedValue(undefined),
  errnoCode: () => undefined,
  readFileBufferSafe: vi.fn().mockResolvedValue(null),
}));

const { rebindBundledAutomations } = await import('./duplicate_rebind');

const ARGS = {
  organizationId: 'org-1',
  orgSlug: 'acme',
  sourceIntegrationSlug: 'imap_smtp',
  newIntegrationSlug: 'imap_smtp-2',
  installedBy: 'a@b.com',
};

function createCtx(installImpl?: () => Promise<unknown>) {
  const runAction = installImpl
    ? vi.fn().mockImplementation(installImpl)
    : vi.fn().mockResolvedValue({ ok: true });
  return {
    runQuery: vi.fn().mockImplementation((ref: string) => {
      if (ref === 'listBound') {
        return Promise.resolve([{ automationSlug: 'imap-smtp/sync-emails' }]);
      }
      return Promise.resolve([]);
    }),
    runAction,
  };
}

describe('rebindBundledAutomations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRm.mockResolvedValue(undefined);
  });

  it('installs the rebound clone with no cron until the instance connects', async () => {
    const ctx = createCtx();

    const rebound = await rebindBundledAutomations(ctx as never, ARGS);

    expect(rebound).toEqual([
      {
        sourceSlug: 'imap-smtp/sync-emails',
        newSlug: 'imap-smtp/sync-emails-2',
      },
    ]);
    expect(ctx.runAction).toHaveBeenCalledWith('install', {
      organizationId: 'org-1',
      automationSlug: 'imap-smtp/sync-emails-2',
      installedBy: 'a@b.com',
      skipSchedules: true,
    });
  });

  it('sweeps the written bundle dir when the install throws', async () => {
    const ctx = createCtx(() => Promise.reject(new Error('install failed')));

    await expect(rebindBundledAutomations(ctx as never, ARGS)).rejects.toThrow(
      'install failed',
    );

    expect(mockRm).toHaveBeenCalledWith(
      '/cfg/acme/automations/imap-smtp/sync-emails-2',
      { recursive: true, force: true },
    );
  });

  it('is a no-op for an integration with no bound automations', async () => {
    const ctx = createCtx();
    ctx.runQuery.mockResolvedValue([]);

    expect(await rebindBundledAutomations(ctx as never, ARGS)).toEqual([]);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });
});

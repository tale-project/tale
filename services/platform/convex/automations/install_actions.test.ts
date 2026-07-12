import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
//
// install/reinstall (via `prepareInstall`) and `uninstallAutomation` are gated on the
// `developerSettings` capability. The gate lives in providers/auth (a node
// helper that issues Better Auth adapter queries), so it is mocked here; each
// test asserts the gate fires BEFORE any resource provisioning/teardown — a
// plain member is rejected with FORBIDDEN_DEVELOPER_SETTINGS and no mutation
// runs.
//
// The filesystem halves (`install_fs`, `install_preflight`) are mocked too so
// the override-confirmation tests can steer the preflight diff and assert the
// write path (installAutomationFiles) never runs on an unconfirmed override.
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  stat: vi
    .fn()
    .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}));

vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
  internalAction: vi.fn((config) => config),
  internalMutation: vi.fn((config) => config),
  internalQuery: vi.fn((config) => config),
  mutation: vi.fn((config) => config),
  query: vi.fn((config) => config),
}));

vi.mock('../_generated/api', () => ({
  internal: {
    automations: {
      install_mutations: {
        upsertAutomationInstallation: 'upsertAutomationInstallation',
        bindAutomationToProject: 'bindAutomationToProject',
        getAutomationInstallationInternal: 'getAutomationInstallationInternal',
        reconcileAutomationSchedules: 'reconcileAutomationSchedules',
        listAutomationBindingsInternal: 'listAutomationBindingsInternal',
      },
    },
  },
}));

const mockRequireDeveloperSettingsAccessById = vi.fn();
vi.mock('../providers/auth', () => ({
  requireDeveloperSettingsAccessById: (...args: unknown[]) =>
    mockRequireDeveloperSettingsAccessById(...args),
}));

const mockInstallAutomationFiles = vi.fn();
const mockReadAutomationBundleManifest = vi.fn();
vi.mock('./install_fs', () => ({
  installAutomationFiles: (...args: unknown[]) =>
    mockInstallAutomationFiles(...args),
  readAutomationBundleManifest: (...args: unknown[]) =>
    mockReadAutomationBundleManifest(...args),
  uninstallAutomationFiles: vi.fn(),
  findMissingResources: vi.fn().mockResolvedValue([]),
}));

const mockDiffAutomationInstall = vi.fn();
vi.mock('./install_preflight', () => ({
  diffAutomationInstall: (...args: unknown[]) =>
    mockDiffAutomationInstall(...args),
  preflightKey: (e: { domain: string; path: string }) =>
    `${e.domain}:${e.path}`,
}));

const {
  installAutomation,
  reinstallAutomation,
  uninstallAutomation,
  previewAutomationInstall,
} = await import('./install_actions');
const { ensureOrgResources, syncAutomationSchedules } =
  await import('./install_actions');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<unknown>;
};

const installHandler = (installAutomation as unknown as ActionConfig).handler;
const reinstallHandler = (reinstallAutomation as unknown as ActionConfig)
  .handler;
const uninstallHandler = (uninstallAutomation as unknown as ActionConfig)
  .handler;
const previewHandler = (previewAutomationInstall as unknown as ActionConfig)
  .handler;

const FORBIDDEN = new ConvexError({
  code: 'FORBIDDEN_DEVELOPER_SETTINGS',
  message: 'Role "member" lacks the developer-settings capability.',
});

const DEVELOPER = {
  orgSlug: 'test-org',
  userId: 'user_1',
  email: 'dev@example.com',
};

const OVERRIDE_ENTRY = {
  domain: 'integrations',
  path: 'github/definition.json',
  kind: 'integration',
  slug: 'github',
  status: 'override',
} as const;

function createMockCtx() {
  return {
    runMutation: vi.fn().mockResolvedValue(undefined),
    runQuery: vi.fn().mockResolvedValue(null),
  };
}

describe('automations/install_actions capability gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireDeveloperSettingsAccessById.mockRejectedValue(FORBIDDEN);
  });

  it('installAutomation rejects a plain member before provisioning resources', async () => {
    const ctx = createMockCtx();
    await expect(
      installHandler(
        ctx as never,
        { organizationId: 'org-123', automationSlug: 'support' } as never,
      ),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' } });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('reinstallAutomation rejects a plain member before re-syncing resources', async () => {
    const ctx = createMockCtx();
    await expect(
      reinstallHandler(
        ctx as never,
        { organizationId: 'org-123', automationSlug: 'support' } as never,
      ),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' } });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('uninstallAutomation rejects a plain member before tearing down resources', async () => {
    const ctx = createMockCtx();
    await expect(
      uninstallHandler(
        ctx as never,
        { organizationId: 'org-123', automationSlug: 'support' } as never,
      ),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' } });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('previewAutomationInstall rejects a plain member before reading org file state', async () => {
    const ctx = createMockCtx();
    await expect(
      previewHandler(
        ctx as never,
        { organizationId: 'org-123', automationSlug: 'support' } as never,
      ),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' } });
    expect(mockDiffAutomationInstall).not.toHaveBeenCalled();
  });
});

describe('automations/install_actions override confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `prepareInstallAs` resolves the org workflows dir for the shadowing
    // guard; the mocked `stat` rejects, so any root works.
    process.env.TALE_CONFIG_DIR = '/tale-test-config';
    mockRequireDeveloperSettingsAccessById.mockResolvedValue(DEVELOPER);
    mockReadAutomationBundleManifest.mockResolvedValue({ name: 'Support' });
    mockInstallAutomationFiles.mockResolvedValue({ resources: [] });
    mockDiffAutomationInstall.mockResolvedValue([OVERRIDE_ENTRY]);
  });

  it('installAutomation with an unconfirmed override throws AUTOMATION_INSTALL_OVERRIDES and writes NOTHING', async () => {
    const ctx = createMockCtx();
    await expect(
      installHandler(
        ctx as never,
        { organizationId: 'org-123', automationSlug: 'support' } as never,
      ),
    ).rejects.toMatchObject({
      data: {
        code: 'AUTOMATION_INSTALL_OVERRIDES',
        overrides: ['integrations:github/definition.json'],
        entries: [OVERRIDE_ENTRY],
      },
    });
    expect(mockInstallAutomationFiles).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('installAutomation proceeds when every override is confirmed (superset is fine)', async () => {
    const ctx = createMockCtx();
    await expect(
      installHandler(
        ctx as never,
        {
          organizationId: 'org-123',
          automationSlug: 'support',
          confirmedOverrides: [
            'integrations:github/definition.json',
            'skills:stale/SKILL.md', // stale extra confirmation — harmless
          ],
        } as never,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(mockInstallAutomationFiles).toHaveBeenCalledTimes(1);
  });

  it('installAutomation rejects a stale confirmation set when a NEW override appeared', async () => {
    mockDiffAutomationInstall.mockResolvedValue([
      OVERRIDE_ENTRY,
      {
        domain: 'skills',
        path: 'triage/SKILL.md',
        kind: 'skill',
        slug: 'triage',
        status: 'override',
      },
    ]);
    const ctx = createMockCtx();
    await expect(
      installHandler(
        ctx as never,
        {
          organizationId: 'org-123',
          automationSlug: 'support',
          confirmedOverrides: ['integrations:github/definition.json'],
        } as never,
      ),
    ).rejects.toMatchObject({ data: { code: 'AUTOMATION_INSTALL_OVERRIDES' } });
    expect(mockInstallAutomationFiles).not.toHaveBeenCalled();
  });

  it('installAutomation with no overrides needs no confirmation', async () => {
    mockDiffAutomationInstall.mockResolvedValue([
      { ...OVERRIDE_ENTRY, status: 'identical' },
    ]);
    const ctx = createMockCtx();
    await expect(
      installHandler(
        ctx as never,
        { organizationId: 'org-123', automationSlug: 'support' } as never,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(mockInstallAutomationFiles).toHaveBeenCalledTimes(1);
  });

  it('reinstallAutomation enforces the same gate before any write', async () => {
    const ctx = createMockCtx();
    await expect(
      reinstallHandler(
        ctx as never,
        { organizationId: 'org-123', automationSlug: 'support' } as never,
      ),
    ).rejects.toMatchObject({ data: { code: 'AUTOMATION_INSTALL_OVERRIDES' } });
    expect(mockInstallAutomationFiles).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();

    await expect(
      reinstallHandler(
        ctx as never,
        {
          organizationId: 'org-123',
          automationSlug: 'support',
          confirmedOverrides: ['integrations:github/definition.json'],
        } as never,
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it('previewAutomationInstall returns the diff entries + override keys', async () => {
    mockDiffAutomationInstall.mockResolvedValue([
      { ...OVERRIDE_ENTRY, status: 'identical' },
      OVERRIDE_ENTRY,
    ]);
    const ctx = createMockCtx();
    await expect(
      previewHandler(
        ctx as never,
        { organizationId: 'org-123', automationSlug: 'support' } as never,
      ),
    ).resolves.toEqual({
      entries: [{ ...OVERRIDE_ENTRY, status: 'identical' }, OVERRIDE_ENTRY],
      overrides: ['integrations:github/definition.json'],
    });
  });
});

describe('ensureOrgResources — prior-ledger thread-through (R1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstallAutomationFiles.mockResolvedValue({ resources: [] });
  });

  it('reads the existing install row and threads its resources into installAutomationFiles', async () => {
    const priorResources = [
      {
        domain: 'skills',
        path: 'triage/SKILL.md',
        contentHash: 'h1',
        adopted: true,
      },
    ];
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue({ resources: priorResources });

    await ensureOrgResources(ctx as never, 'org-123', 'support', {
      orgSlug: 'test-org',
      installedBy: 'dev@example.com',
      manifest: { name: 'Support' },
    } as never);

    expect(ctx.runQuery).toHaveBeenCalledWith(
      'getAutomationInstallationInternal',
      {
        organizationId: 'org-123',
        automationSlug: 'support',
      },
    );
    // THE critical assertion: a dropped thread here silently converts every
    // adopted file into an automation-owned one the next uninstall deletes.
    expect(mockInstallAutomationFiles).toHaveBeenCalledWith(
      'test-org',
      'support',
      priorResources,
    );
  });

  it('passes undefined resources for a fresh install (no existing row)', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue(null);
    await ensureOrgResources(ctx as never, 'org-123', 'support', {
      orgSlug: 'test-org',
      installedBy: 'dev@example.com',
      manifest: { name: 'Support' },
    } as never);
    expect(mockInstallAutomationFiles).toHaveBeenCalledWith(
      'test-org',
      'support',
      undefined,
    );
  });
});

describe('syncAutomationSchedules — binding projectId seeding (#2607)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** A project-scoped manifest whose inline workflow declares one schedule and
   *  a start `inputSchema` (with or without a `projectId` input). */
  const manifestWith = (properties: Record<string, unknown>) =>
    ({
      name: 'Triage',
      scope: 'project',
      workflow: {
        triggers: {
          schedules: [{ cron: '*/30 * * * *', timezone: 'UTC', variables: {} }],
        },
        steps: [
          {
            stepSlug: 'start',
            name: 'Start',
            stepType: 'start',
            config: {
              inputSchema: { properties, required: Object.keys(properties) },
            },
            nextSteps: {},
          },
        ],
      },
    }) as never;

  it('seeds variables.projectId from each binding when the start schema declares it', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue([{ projectId: 'proj_1' }]);

    await syncAutomationSchedules(
      ctx as never,
      'org-123',
      'triage',
      manifestWith({
        owner: { type: 'string' },
        projectId: { type: 'string' },
      }),
    );

    expect(ctx.runMutation).toHaveBeenCalledWith(
      'reconcileAutomationSchedules',
      {
        organizationId: 'org-123',
        automationSlug: 'triage',
        desired: [
          {
            workflowSlug: 'triage',
            cronExpression: '*/30 * * * *',
            timezone: 'UTC',
            projectId: 'proj_1',
            variables: { projectId: 'proj_1' },
          },
        ],
      },
    );
  });

  it('never invents projectId when the start schema does not declare it', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue([{ projectId: 'proj_1' }]);

    await syncAutomationSchedules(
      ctx as never,
      'org-123',
      'triage',
      manifestWith({ owner: { type: 'string' } }),
    );

    expect(ctx.runMutation).toHaveBeenCalledWith(
      'reconcileAutomationSchedules',
      {
        organizationId: 'org-123',
        automationSlug: 'triage',
        desired: [
          {
            workflowSlug: 'triage',
            cronExpression: '*/30 * * * *',
            timezone: 'UTC',
            projectId: 'proj_1',
            variables: {},
          },
        ],
      },
    );
  });
});

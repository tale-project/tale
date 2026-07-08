import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — same shape as `install_actions.test.ts`: the capability gate is
// mocked (covered on its own there), and the single-automation install CORE
// (`install_actions.ts`'s exports) is mocked here so this suite exercises
// ONLY the bundle-aggregation logic: member resolution/validation, ordering,
// per-member override namespacing, and partial-failure reporting — never a
// second copy of the single-automation install path's own behaviour.
// ---------------------------------------------------------------------------

vi.mock('../_generated/server', () => ({
  action: (config: unknown) => config,
}));

vi.mock('../_generated/api', () => ({
  internal: {
    automations: {
      install_mutations: {
        bindAutomationToProject: 'bindAutomationToProject',
      },
    },
  },
}));

const mockRequireDeveloperSettingsAccessById = vi.fn();
vi.mock('../providers/auth', () => ({
  requireDeveloperSettingsAccessById: (...args: unknown[]) =>
    mockRequireDeveloperSettingsAccessById(...args),
}));

const mockReadAutomationBundleManifest = vi.fn();
const mockReadBundleManifest = vi.fn();
vi.mock('./install_fs', () => ({
  readAutomationBundleManifest: (...args: unknown[]) =>
    mockReadAutomationBundleManifest(...args),
  readBundleManifest: (...args: unknown[]) => mockReadBundleManifest(...args),
}));

const mockDiffAutomationInstall = vi.fn();
vi.mock('./install_preflight', () => ({
  diffAutomationInstall: (...args: unknown[]) =>
    mockDiffAutomationInstall(...args),
  preflightKey: (e: { domain: string; path: string }) =>
    `${e.domain}:${e.path}`,
}));

const mockPrepareInstallAs = vi.fn();
const mockAssertOverridesConfirmed = vi.fn();
const mockEnsureOrgResources = vi.fn();
const mockSyncAutomationSchedules = vi.fn();
vi.mock('./install_actions', () => ({
  prepareInstallAs: (...args: unknown[]) => mockPrepareInstallAs(...args),
  assertOverridesConfirmed: (...args: unknown[]) =>
    mockAssertOverridesConfirmed(...args),
  ensureOrgResources: (...args: unknown[]) => mockEnsureOrgResources(...args),
  syncAutomationSchedules: (...args: unknown[]) =>
    mockSyncAutomationSchedules(...args),
  preflightEntryValidator: {},
}));

const { previewBundleInstall, installBundle } =
  await import('./install_bundle_actions');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<unknown>;
};
const previewHandler = (previewBundleInstall as unknown as ActionConfig)
  .handler;
const installHandler = (installBundle as unknown as ActionConfig).handler;

const DEVELOPER = {
  orgSlug: 'test-org',
  userId: 'user_1',
  email: 'dev@example.com',
};

function createMockCtx() {
  return {
    runMutation: vi.fn().mockResolvedValue(undefined),
    runQuery: vi.fn().mockResolvedValue(null),
  };
}

/**
 * Manifests keyed by slug. `readAutomationBundleManifest` (members) returns any
 * of them; `readBundleManifest` (the bundle read) mirrors the real reader —
 * it returns the manifest only when it declares `bundle.members`, else `null`
 * ("not a bundle"), which is how `resolveBundle` maps to `NOT_A_BUNDLE`.
 */
function manifestsBySlug(manifests: Record<string, unknown>) {
  mockReadAutomationBundleManifest.mockImplementation(
    (_orgSlug: string, slug: string) => {
      const manifest = manifests[slug];
      if (!manifest) return Promise.reject(new Error(`not found: ${slug}`));
      return Promise.resolve(manifest);
    },
  );
  mockReadBundleManifest.mockImplementation(
    (_orgSlug: string, slug: string) => {
      const manifest = manifests[slug];
      const isBundle =
        manifest !== undefined &&
        manifest !== null &&
        typeof manifest === 'object' &&
        'bundle' in manifest;
      return Promise.resolve(isBundle ? manifest : null);
    },
  );
}

const ORG_BUNDLE = {
  name: 'Email',
  bundle: { members: ['reply-gmail-emails', 'reply-outlook-emails'] },
};
const GMAIL_MEMBER = {
  name: 'Reply to Gmail emails',
  hidden: true,
  requires: { integrations: ['gmail'] },
};
const OUTLOOK_MEMBER = {
  name: 'Reply to Outlook emails',
  hidden: true,
  requires: { integrations: ['outlook'] },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireDeveloperSettingsAccessById.mockResolvedValue(DEVELOPER);
  mockDiffAutomationInstall.mockResolvedValue([]);
  mockPrepareInstallAs.mockImplementation(
    (orgSlug: string, automationSlug: string, installedBy: string) =>
      Promise.resolve({
        orgSlug,
        installedBy,
        manifest: { name: automationSlug },
      }),
  );
  mockAssertOverridesConfirmed.mockResolvedValue(undefined);
  mockEnsureOrgResources.mockResolvedValue({
    workflows: 1,
    agents: 1,
    resources: 2,
  });
  mockSyncAutomationSchedules.mockResolvedValue(undefined);
});

describe('previewBundleInstall', () => {
  it('rejects a plain member before reading org file state', async () => {
    mockRequireDeveloperSettingsAccessById.mockRejectedValue(
      new ConvexError({ code: 'FORBIDDEN_DEVELOPER_SETTINGS' }),
    );
    const ctx = createMockCtx();
    await expect(
      previewHandler(
        ctx as never,
        { organizationId: 'org-123', bundleSlug: 'email-bundle' } as never,
      ),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' } });
    expect(mockDiffAutomationInstall).not.toHaveBeenCalled();
  });

  it('returns one preflight entry per member, in declared order', async () => {
    manifestsBySlug({
      'email-bundle': ORG_BUNDLE,
      'reply-gmail-emails': GMAIL_MEMBER,
      'reply-outlook-emails': OUTLOOK_MEMBER,
    });
    mockDiffAutomationInstall.mockImplementation(
      (_orgSlug: string, slug: string) =>
        Promise.resolve([
          {
            domain: 'automation',
            path: 'automation.json',
            kind: 'manifest',
            status: 'create',
          },
          ...(slug === 'reply-outlook-emails'
            ? [
                {
                  domain: 'integrations',
                  path: 'outlook/definition.json',
                  kind: 'integration',
                  slug: 'outlook',
                  status: 'override',
                },
              ]
            : []),
        ]),
    );

    const ctx = createMockCtx();
    const result = (await previewHandler(
      ctx as never,
      { organizationId: 'org-123', bundleSlug: 'email-bundle' } as never,
    )) as Array<{
      automationSlug: string;
      automationName: string;
      requiredIntegrations: string[];
      overrides: string[];
    }>;

    expect(result.map((r) => r.automationSlug)).toEqual([
      'reply-gmail-emails',
      'reply-outlook-emails',
    ]);
    expect(result[0]).toMatchObject({
      automationName: 'Reply to Gmail emails',
      requiredIntegrations: ['gmail'],
      overrides: [],
    });
    expect(result[1]).toMatchObject({
      automationName: 'Reply to Outlook emails',
      requiredIntegrations: ['outlook'],
      overrides: ['integrations:outlook/definition.json'],
    });
  });

  it('rejects a manifest with no bundle.members (NOT_A_BUNDLE)', async () => {
    manifestsBySlug({ 'not-a-bundle': { name: 'Plain' } });
    const ctx = createMockCtx();
    await expect(
      previewHandler(
        ctx as never,
        { organizationId: 'org-123', bundleSlug: 'not-a-bundle' } as never,
      ),
    ).rejects.toMatchObject({ data: { code: 'NOT_A_BUNDLE' } });
  });

  it('rejects with INVALID_BUNDLE when a member is missing or not hidden', async () => {
    manifestsBySlug({
      'email-bundle': {
        name: 'Email',
        bundle: { members: ['reply-gmail-emails', 'ghost-member'] },
      },
      // reply-gmail-emails is NOT hidden — a bundle-shape violation.
      'reply-gmail-emails': { name: 'Reply to Gmail emails' },
    });
    const ctx = createMockCtx();
    await expect(
      previewHandler(
        ctx as never,
        { organizationId: 'org-123', bundleSlug: 'email-bundle' } as never,
      ),
    ).rejects.toMatchObject({ data: { code: 'INVALID_BUNDLE' } });
  });

  it('rejects with INVALID_BUNDLE on a scope mismatch between members', async () => {
    manifestsBySlug({
      'mixed-bundle': {
        name: 'Mixed',
        scope: 'org',
        bundle: { members: ['org-member', 'project-member'] },
      },
      'org-member': { name: 'Org Member', hidden: true, scope: 'org' },
      'project-member': {
        name: 'Project Member',
        hidden: true,
        scope: 'project',
      },
    });
    const ctx = createMockCtx();
    await expect(
      previewHandler(
        ctx as never,
        { organizationId: 'org-123', bundleSlug: 'mixed-bundle' } as never,
      ),
    ).rejects.toMatchObject({ data: { code: 'INVALID_BUNDLE' } });
  });
});

describe('installBundle', () => {
  beforeEach(() => {
    manifestsBySlug({
      'email-bundle': ORG_BUNDLE,
      'reply-gmail-emails': GMAIL_MEMBER,
      'reply-outlook-emails': OUTLOOK_MEMBER,
    });
  });

  it('rejects a plain member before installing anything', async () => {
    mockRequireDeveloperSettingsAccessById.mockRejectedValue(
      new ConvexError({ code: 'FORBIDDEN_DEVELOPER_SETTINGS' }),
    );
    const ctx = createMockCtx();
    await expect(
      installHandler(
        ctx as never,
        { organizationId: 'org-123', bundleSlug: 'email-bundle' } as never,
      ),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' } });
    expect(mockEnsureOrgResources).not.toHaveBeenCalled();
  });

  it('installs every member in declared order and returns per-member counts (aggregation)', async () => {
    const ctx = createMockCtx();
    const result = (await installHandler(
      ctx as never,
      { organizationId: 'org-123', bundleSlug: 'email-bundle' } as never,
    )) as {
      ok: boolean;
      members: Array<{
        automationSlug: string;
        ok: boolean;
        workflows?: number;
      }>;
    };

    expect(result.ok).toBe(true);
    expect(result.members).toEqual([
      {
        automationSlug: 'reply-gmail-emails',
        ok: true,
        workflows: 1,
        agents: 1,
        resources: 2,
      },
      {
        automationSlug: 'reply-outlook-emails',
        ok: true,
        workflows: 1,
        agents: 1,
        resources: 2,
      },
    ]);
    // Declared order, not sorted.
    expect(mockPrepareInstallAs.mock.calls.map((c) => c[1])).toEqual([
      'reply-gmail-emails',
      'reply-outlook-emails',
    ]);
  });

  it('installs cleanly when two members require the same integration (no dedup conflict)', async () => {
    manifestsBySlug({
      'email-bundle': ORG_BUNDLE,
      'reply-gmail-emails': {
        ...GMAIL_MEMBER,
        requires: { integrations: ['shared-smtp'] },
      },
      'reply-outlook-emails': {
        ...OUTLOOK_MEMBER,
        requires: { integrations: ['shared-smtp'] },
      },
    });

    const ctx = createMockCtx();
    const result = (await installHandler(
      ctx as never,
      { organizationId: 'org-123', bundleSlug: 'email-bundle' } as never,
    )) as {
      ok: boolean;
      members: Array<{ automationSlug: string; ok: boolean }>;
    };

    expect(result.ok).toBe(true);
    expect(result.members.every((m) => m.ok)).toBe(true);
    // Each member's own install core runs independently — overlap in a
    // shared integration slug across members is never a conflict here.
    expect(mockEnsureOrgResources).toHaveBeenCalledTimes(2);
  });

  it('namespaces confirmedOverridesByAutomation per member — one member confirmed does not confirm its sibling', async () => {
    mockAssertOverridesConfirmed.mockImplementation(
      (_orgSlug: string, automationSlug: string, confirmed?: string[]) => {
        if (automationSlug === 'reply-outlook-emails' && !confirmed?.length) {
          throw new ConvexError({
            code: 'AUTOMATION_INSTALL_OVERRIDES',
            message: 'unconfirmed override',
          });
        }
        return Promise.resolve();
      },
    );

    const ctx = createMockCtx();
    const result = (await installHandler(
      ctx as never,
      {
        organizationId: 'org-123',
        bundleSlug: 'email-bundle',
        confirmedOverridesByAutomation: {
          'reply-gmail-emails': ['integrations:gmail/definition.json'],
        },
      } as never,
    )) as {
      ok: boolean;
      members: Array<{ automationSlug: string; ok: boolean }>;
    };

    expect(result.ok).toBe(false);
    expect(result.members).toEqual([
      expect.objectContaining({
        automationSlug: 'reply-gmail-emails',
        ok: true,
      }),
      expect.objectContaining({
        automationSlug: 'reply-outlook-emails',
        ok: false,
      }),
    ]);
  });

  it('reports a member failure without stopping the rest (not transactional)', async () => {
    mockEnsureOrgResources.mockImplementation(
      (_ctx: unknown, _orgId: string, automationSlug: string) => {
        if (automationSlug === 'reply-gmail-emails') {
          return Promise.reject(new Error('disk full'));
        }
        return Promise.resolve({ workflows: 1, agents: 1, resources: 2 });
      },
    );

    const ctx = createMockCtx();
    const result = (await installHandler(
      ctx as never,
      { organizationId: 'org-123', bundleSlug: 'email-bundle' } as never,
    )) as {
      ok: boolean;
      members: Array<{ automationSlug: string; ok: boolean; error?: string }>;
    };

    expect(result.ok).toBe(false);
    expect(result.members[0]).toMatchObject({
      automationSlug: 'reply-gmail-emails',
      ok: false,
      error: 'disk full',
    });
    expect(result.members[1]).toMatchObject({
      automationSlug: 'reply-outlook-emails',
      ok: true,
    });
  });

  it('org-scoped bundle rejects a projectId', async () => {
    const ctx = createMockCtx();
    await expect(
      installHandler(
        ctx as never,
        {
          organizationId: 'org-123',
          bundleSlug: 'email-bundle',
          projectId: 'project-1',
        } as never,
      ),
    ).rejects.toThrow(/org-scoped/);
    expect(mockEnsureOrgResources).not.toHaveBeenCalled();
  });

  it('project-scoped bundle requires a projectId, then binds + syncs schedules per member', async () => {
    manifestsBySlug({
      'project-bundle': {
        name: 'Project Bundle',
        scope: 'project',
        bundle: { members: ['member-a'] },
      },
      'member-a': { name: 'Member A', hidden: true, scope: 'project' },
    });

    const ctxMissingProject = createMockCtx();
    await expect(
      installHandler(
        ctxMissingProject as never,
        { organizationId: 'org-123', bundleSlug: 'project-bundle' } as never,
      ),
    ).rejects.toThrow(/project-scoped/);

    const ctx = createMockCtx();
    const result = (await installHandler(
      ctx as never,
      {
        organizationId: 'org-123',
        bundleSlug: 'project-bundle',
        projectId: 'project-1',
      } as never,
    )) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(ctx.runMutation).toHaveBeenCalledWith('bindAutomationToProject', {
      organizationId: 'org-123',
      automationSlug: 'member-a',
      projectId: 'project-1',
      boundBy: 'dev@example.com',
    });
    expect(mockSyncAutomationSchedules).toHaveBeenCalledWith(
      ctx,
      'org-123',
      'member-a',
      { name: 'member-a' },
    );
  });
});

import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
//
// install/reinstall (via `prepareInstall`) and `uninstallApp` are gated on the
// `developerSettings` capability. The gate lives in providers/auth (a node
// helper that issues Better Auth adapter queries), so it is mocked here; each
// test asserts the gate fires BEFORE any resource provisioning/teardown — a
// plain member is rejected with FORBIDDEN_DEVELOPER_SETTINGS and no mutation
// runs.
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
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
    apps: {
      install_mutations: {
        upsertAppInstallation: 'upsertAppInstallation',
        bindAppToProject: 'bindAppToProject',
      },
    },
  },
}));

const mockRequireDeveloperSettingsAccessById = vi.fn();
vi.mock('../providers/auth', () => ({
  requireDeveloperSettingsAccessById: (...args: unknown[]) =>
    mockRequireDeveloperSettingsAccessById(...args),
}));

const { installApp, reinstallApp, uninstallApp } =
  await import('./install_actions');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<unknown>;
};

const installHandler = (installApp as unknown as ActionConfig).handler;
const reinstallHandler = (reinstallApp as unknown as ActionConfig).handler;
const uninstallHandler = (uninstallApp as unknown as ActionConfig).handler;

const FORBIDDEN = new ConvexError({
  code: 'FORBIDDEN_DEVELOPER_SETTINGS',
  message: 'Role "member" lacks the developer-settings capability.',
});

function createMockCtx() {
  return {
    runMutation: vi.fn().mockResolvedValue(undefined),
    runQuery: vi.fn().mockResolvedValue(null),
  };
}

describe('apps/install_actions capability gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireDeveloperSettingsAccessById.mockRejectedValue(FORBIDDEN);
  });

  it('installApp rejects a plain member before provisioning resources', async () => {
    const ctx = createMockCtx();
    await expect(
      installHandler(
        ctx as never,
        { organizationId: 'org-123', appSlug: 'support' } as never,
      ),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' } });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('reinstallApp rejects a plain member before re-syncing resources', async () => {
    const ctx = createMockCtx();
    await expect(
      reinstallHandler(
        ctx as never,
        { organizationId: 'org-123', appSlug: 'support' } as never,
      ),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' } });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('uninstallApp rejects a plain member before tearing down resources', async () => {
    const ctx = createMockCtx();
    await expect(
      uninstallHandler(
        ctx as never,
        { organizationId: 'org-123', appSlug: 'support' } as never,
      ),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' } });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
});

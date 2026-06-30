import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return { ...actual, default: actual };
});

vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
  internalAction: vi.fn((config) => config),
}));

vi.mock('../_generated/api', () => ({
  internal: {
    integrations: {
      credential_queries: {
        getBySlugInternal: 'getBySlugInternal',
        listInternal: 'listInternal',
      },
      credential_mutations: {
        createCredentials: 'createCredentials',
        deleteCredentialsInternal: 'deleteCredentialsInternal',
      },
    },
  },
}));

const mockAtomicWrite = vi.fn();
const mockReadFileSafe = vi.fn();
const mockReadJsonFile = vi.fn();
vi.mock('../lib/file_io', () => ({
  atomicWrite: (...args: unknown[]) => mockAtomicWrite(...args),
  readFileSafe: (...args: unknown[]) => mockReadFileSafe(...args),
  readJsonFile: (...args: unknown[]) => mockReadJsonFile(...args),
  sha256: () => 'mock-hash',
}));

// The capability gate lives in providers/auth (a `'use node'` helper that issues
// Better Auth adapter queries). Mock it so each test can choose "developer
// allowed" vs "plain member rejected" — the surface under test is whether these
// destructive actions invoke the gate BEFORE any credential/file mutation.
const mockRequireDeveloperSettingsAccessById = vi.fn();
const mockRequireOrgMembershipById = vi.fn();
vi.mock('../providers/auth', () => ({
  requireDeveloperSettingsAccessById: (...args: unknown[]) =>
    mockRequireDeveloperSettingsAccessById(...args),
}));
vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: (...args: unknown[]) =>
    mockRequireOrgMembershipById(...args),
}));

vi.mock('./file_utils', async () => {
  const actual =
    await vi.importActual<typeof import('./file_utils')>('./file_utils');
  return {
    ...actual,
    resolveConfigPath: (orgSlug: string, slug: string) =>
      `/data/integrations/${orgSlug}/${slug}/config.json`,
    resolveIntegrationDir: (orgSlug: string, slug: string) =>
      `/data/integrations/${orgSlug}/${slug}`,
    parseIntegrationJson: (s: string) => JSON.parse(s),
    serializeIntegrationJson: (c: unknown) => JSON.stringify(c),
  };
});

// ---------------------------------------------------------------------------
// Import handlers
// ---------------------------------------------------------------------------

const {
  installIntegration,
  uninstallIntegration,
  saveIntegrationConfig,
  writeIntegrationFiles,
} = await import('./file_actions');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<unknown>;
};

const installHandler = (installIntegration as unknown as ActionConfig).handler;
const uninstallHandler = (uninstallIntegration as unknown as ActionConfig)
  .handler;
const saveConfigHandler = (saveIntegrationConfig as unknown as ActionConfig)
  .handler;
const writeFilesHandler = (writeIntegrationFiles as unknown as ActionConfig)
  .handler;

function createMockCtx() {
  return {
    runMutation: vi.fn().mockResolvedValue('cred-id'),
    runQuery: vi.fn().mockResolvedValue(null),
  };
}

const FORBIDDEN = new ConvexError({
  code: 'FORBIDDEN_DEVELOPER_SETTINGS',
  message: 'Role "member" lacks the developer-settings capability.',
});

describe('integrations/file_actions capability gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireDeveloperSettingsAccessById.mockResolvedValue({
      orgId: 'org-123',
      orgSlug: 'default',
      userId: 'user-1',
      email: 'a@b.com',
      member: { _id: 'm-1', role: 'developer' },
    });
    mockReadFileSafe.mockResolvedValue(null);
    mockReadJsonFile.mockResolvedValue({
      ok: true,
      data: { title: 'X', authMethod: 'apiKey' },
      hash: 'h',
    });
  });

  // Each surface must gate on `developerSettings` (not plain membership). The
  // gate is asserted by: (a) a plain member is rejected with
  // FORBIDDEN_DEVELOPER_SETTINGS and no destructive work runs, and (b) the gate
  // is called before any credential/file mutation. If a refactor drops the gate
  // these tests fail (the rejection no longer propagates).

  describe('uninstallIntegration', () => {
    it('rejects a plain member and does not delete the credential', async () => {
      mockRequireDeveloperSettingsAccessById.mockRejectedValue(FORBIDDEN);
      const ctx = createMockCtx();

      await expect(
        uninstallHandler(
          ctx as never,
          { slug: 'slack', organizationId: 'org-123' } as never,
        ),
      ).rejects.toMatchObject({
        data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' },
      });
      expect(ctx.runMutation).not.toHaveBeenCalled();
    });

    it('deletes the credential for a developer', async () => {
      const ctx = createMockCtx();
      ctx.runQuery.mockResolvedValue({ _id: 'cred-1' });

      const result = await uninstallHandler(
        ctx as never,
        { slug: 'slack', organizationId: 'org-123' } as never,
      );

      expect(result).toEqual({ deleted: true });
      expect(ctx.runMutation).toHaveBeenCalledWith(
        'deleteCredentialsInternal',
        {
          credentialId: 'cred-1',
        },
      );
    });
  });

  describe('installIntegration', () => {
    it('rejects a plain member and does not create a credential', async () => {
      mockRequireDeveloperSettingsAccessById.mockRejectedValue(FORBIDDEN);
      const ctx = createMockCtx();

      await expect(
        installHandler(
          ctx as never,
          { slug: 'slack', organizationId: 'org-123' } as never,
        ),
      ).rejects.toMatchObject({
        data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' },
      });
      expect(ctx.runMutation).not.toHaveBeenCalled();
    });
  });

  describe('saveIntegrationConfig', () => {
    it('rejects a plain member and does not write to disk', async () => {
      mockRequireDeveloperSettingsAccessById.mockRejectedValue(FORBIDDEN);
      const ctx = createMockCtx();

      await expect(
        saveConfigHandler(
          ctx as never,
          { organizationId: 'org-123', slug: 'slack', config: {} } as never,
        ),
      ).rejects.toMatchObject({
        data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' },
      });
      expect(mockAtomicWrite).not.toHaveBeenCalled();
    });
  });

  describe('writeIntegrationFiles', () => {
    it('rejects a plain member and does not write config or connector code', async () => {
      mockRequireDeveloperSettingsAccessById.mockRejectedValue(FORBIDDEN);
      const ctx = createMockCtx();

      await expect(
        writeFilesHandler(
          ctx as never,
          {
            organizationId: 'org-123',
            slug: 'slack',
            config: {},
            connectorCode: 'export const x = 1;',
          } as never,
        ),
      ).rejects.toMatchObject({
        data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' },
      });
      expect(mockAtomicWrite).not.toHaveBeenCalled();
    });
  });
});

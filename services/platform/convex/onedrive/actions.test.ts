/**
 * Wiring tests for `importFiles`' guard seams: the caller must be a member of
 * the target org before anything runs, and a failed Microsoft token bails
 * before any import. The engine install that used to follow a SYNC import is
 * parked while the automation engine is rebuilt, so the handler must not
 * schedule anything. Direct-handler pattern: the codegen surface is mocked so
 * `action(config)` returns the config, and the import/list implementations
 * are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
}));

const mockRequireOrgMembershipById = vi.fn();
vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: (...args: unknown[]) =>
    mockRequireOrgMembershipById(...args),
}));

const mockWithMicrosoftToken = vi.fn();
vi.mock('./with_microsoft_token', () => ({
  withMicrosoftToken: (...args: unknown[]) => mockWithMicrosoftToken(...args),
}));

const mockImportFilesImpl = vi.fn();
vi.mock('./import_files', () => ({
  importFiles: (...args: unknown[]) => mockImportFilesImpl(...args),
}));

vi.mock('./import_files_deps', () => ({
  createImportFilesDeps: vi.fn().mockReturnValue({}),
}));

vi.mock('./list_files', () => ({ listFiles: vi.fn() }));
vi.mock('./list_sharepoint_sites', () => ({ listSharePointSites: vi.fn() }));
vi.mock('./list_sharepoint_drives', () => ({ listSharePointDrives: vi.fn() }));
vi.mock('./list_sharepoint_files', () => ({ listSharePointFiles: vi.fn() }));

const { importFiles } = await import('./actions');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<unknown>;
};
const importHandler = (importFiles as unknown as ActionConfig).handler;

const EMPTY_IMPORT_RESULT = {
  success: true,
  results: [],
  totalFiles: 0,
  successCount: 0,
  failedCount: 0,
  skippedCount: 0,
};

function createMockCtx() {
  return { scheduler: { runAfter: vi.fn().mockResolvedValue(undefined) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgMembershipById.mockResolvedValue({
    orgId: 'org1',
    orgSlug: 'acme',
    userId: 'user_1',
  });
  mockWithMicrosoftToken.mockResolvedValue({
    success: true,
    token: 'tok',
    userId: 'user_1',
  });
  mockImportFilesImpl.mockResolvedValue(EMPTY_IMPORT_RESULT);
});

describe('importFiles — org gate and import pass-through', () => {
  it('a SYNC import passes through without scheduling an engine install', async () => {
    const ctx = createMockCtx();
    const result = await importHandler(
      ctx as never,
      {
        items: [],
        organizationId: 'org1',
        importType: 'sync',
      } as never,
    );

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
    expect(mockImportFilesImpl).toHaveBeenCalledOnce();
    expect(result).toEqual(EMPTY_IMPORT_RESULT);
  });

  it('a caller outside the org is rejected before any import', async () => {
    mockRequireOrgMembershipById.mockRejectedValue(new Error('ORG_FORBIDDEN'));

    const ctx = createMockCtx();
    await expect(
      importHandler(
        ctx as never,
        {
          items: [],
          organizationId: 'someone-elses-org',
          importType: 'sync',
        } as never,
      ),
    ).rejects.toThrow('ORG_FORBIDDEN');

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
    expect(mockImportFilesImpl).not.toHaveBeenCalled();
    expect(mockWithMicrosoftToken).not.toHaveBeenCalled();
  });

  it('a failed Microsoft token bails before any import', async () => {
    mockWithMicrosoftToken.mockResolvedValue({
      success: false,
      error: 'no account',
    });

    const ctx = createMockCtx();
    const result = (await importHandler(
      ctx as never,
      {
        items: [],
        organizationId: 'org1',
        importType: 'sync',
      } as never,
    )) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe('no account');
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
    expect(mockImportFilesImpl).not.toHaveBeenCalled();
  });
});

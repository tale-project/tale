/**
 * Wiring tests for `importFiles`' engine opt-in: a SYNC import is the single
 * moment the org opts into the hidden `onedrive/sync-files` engine, so the
 * handler must schedule the targeted idempotent install (and nothing must on
 * a one-time import or a failed token). Same direct-handler pattern as
 * `automations/install_actions.test.ts`: the codegen surface is mocked so
 * `action(config)` returns the config, and the import/list implementations
 * are stubbed — this suite proves only the scheduling seam.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
}));

vi.mock('../_generated/api', () => ({
  internal: {
    automations: {
      install_actions: {
        installAutomationInternal: 'installAutomationInternal',
      },
    },
  },
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
  mockWithMicrosoftToken.mockResolvedValue({
    success: true,
    token: 'tok',
    userId: 'user_1',
  });
  mockImportFilesImpl.mockResolvedValue(EMPTY_IMPORT_RESULT);
});

describe('importFiles — sync-import engine opt-in', () => {
  it('a SYNC import schedules the targeted idempotent engine install', async () => {
    const ctx = createMockCtx();
    const result = await importHandler(
      ctx as never,
      {
        items: [],
        organizationId: 'org1',
        importType: 'sync',
      } as never,
    );

    expect(ctx.scheduler.runAfter).toHaveBeenCalledExactlyOnceWith(
      0,
      'installAutomationInternal',
      {
        organizationId: 'org1',
        automationSlug: 'onedrive/sync-files',
        installedBy: 'user_1',
      },
    );
    expect(result).toEqual(EMPTY_IMPORT_RESULT);
  });

  it('a ONE-TIME import never installs the engine', async () => {
    const ctx = createMockCtx();
    await importHandler(
      ctx as never,
      {
        items: [],
        organizationId: 'org1',
        importType: 'one-time',
      } as never,
    );

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('a failed Microsoft token bails before any install or import', async () => {
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

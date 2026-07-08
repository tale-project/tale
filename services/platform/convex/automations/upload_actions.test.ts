import { rm } from 'node:fs/promises';

import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// `deleteAutomation` (#2355) guards, in isolation. The action is `'use node'` and pulls
// in the fs resolvers + the built-in-catalog probe + the developer-settings
// gate; all are mocked so each test exercises exactly one branch and asserts the
// destructive `rm` fires only on the allowed path.
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
}));

vi.mock('../_generated/api', () => ({
  internal: {
    automations: {
      upload_mutations: {
        verifyAutomationUploadIntent: 'verifyAutomationUploadIntent',
        deleteAutomationUploadIntent: 'deleteAutomationUploadIntent',
        claimAutomationUploadSlot: 'claimAutomationUploadSlot',
        releaseAutomationUploadSlot: 'releaseAutomationUploadSlot',
      },
      install_mutations: {
        getAutomationInstallationInternal: 'getAutomationInstallationInternal',
      },
    },
  },
}));

const mockRequireOrgAdminOrDeveloper = vi.fn();
vi.mock('../lib/auth/require_org_admin_or_developer', () => ({
  requireOrgAdminOrDeveloper: (...args: unknown[]) =>
    mockRequireOrgAdminOrDeveloper(...args),
}));

const mockAutomationExistsInBuiltinCatalog = vi.fn();
vi.mock('./install_fs', () => ({
  automationExistsInBuiltinCatalog: (...args: unknown[]) =>
    mockAutomationExistsInBuiltinCatalog(...args),
}));

const mockReadFileSafe = vi.fn();
vi.mock('../lib/file_io', () => ({
  atomicWriteBuffer: vi.fn(),
  readFileSafe: (...args: unknown[]) => mockReadFileSafe(...args),
  verifyPathWithinBase: vi.fn(),
}));

vi.mock('./file_utils', () => ({
  resolveAutomationDir: (orgSlug: string, slug: string) =>
    `/cfg/${orgSlug}/automations/${slug}`,
  resolveAutomationManifestPath: (orgSlug: string, slug: string) =>
    `/cfg/${orgSlug}/automations/${slug}/automation.json`,
  resolveAutomationsDir: (orgSlug: string) => `/cfg/${orgSlug}/automations`,
}));

vi.mock('./bundle_parse', () => ({ parseAutomationBundleZip: vi.fn() }));

const { deleteAutomation } = await import('./upload_actions');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<unknown>;
};
const deleteHandler = (deleteAutomation as unknown as ActionConfig).handler;

function createMockCtx(installRecord: unknown = null) {
  return { runQuery: vi.fn().mockResolvedValue(installRecord) } as never;
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the handler to reject');
    },
    (err) => err,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgAdminOrDeveloper.mockResolvedValue({ orgSlug: 'acme' });
});

describe('automations/upload_actions deleteAutomation (#2355)', () => {
  it('rejects an invalid slug before touching auth or the filesystem', async () => {
    const err = (await catchError(
      deleteHandler(createMockCtx(), {
        organizationId: 'org',
        slug: '../evil',
      } as never),
    )) as ConvexError<{ code: string }>;
    expect(err).toBeInstanceOf(ConvexError);
    expect(err.data.code).toBe('INVALID_SLUG');
    expect(mockRequireOrgAdminOrDeveloper).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });

  it('refuses to delete a built-in catalog automation', async () => {
    mockAutomationExistsInBuiltinCatalog.mockResolvedValue(true);
    const err = (await catchError(
      deleteHandler(createMockCtx(), {
        organizationId: 'org',
        slug: 'issue-desk',
      } as never),
    )) as ConvexError<{ code: string }>;
    expect(err.data.code).toBe('AUTOMATION_IS_BUILTIN');
    expect(rm).not.toHaveBeenCalled();
  });

  it('refuses while an install record still exists', async () => {
    mockAutomationExistsInBuiltinCatalog.mockResolvedValue(false);
    const err = (await catchError(
      deleteHandler(createMockCtx({ automationSlug: 'my-upload' }), {
        organizationId: 'org',
        slug: 'my-upload',
      } as never),
    )) as ConvexError<{ code: string }>;
    expect(err.data.code).toBe('AUTOMATION_INSTALLED');
    expect(rm).not.toHaveBeenCalled();
  });

  it('removes the org automation dir for a private, not-installed automation', async () => {
    mockAutomationExistsInBuiltinCatalog.mockResolvedValue(false);
    mockReadFileSafe.mockResolvedValue('{"name":"X"}');
    const result = await deleteHandler(createMockCtx(null), {
      organizationId: 'org',
      slug: 'my-upload',
    } as never);
    expect(result).toEqual({ deleted: true });
    expect(rm).toHaveBeenCalledWith('/cfg/acme/automations/my-upload', {
      recursive: true,
      force: true,
    });
  });

  it('is a no-op when no bundle is on disk', async () => {
    mockAutomationExistsInBuiltinCatalog.mockResolvedValue(false);
    mockReadFileSafe.mockResolvedValue(null);
    const result = await deleteHandler(createMockCtx(null), {
      organizationId: 'org',
      slug: 'my-upload',
    } as never);
    expect(result).toEqual({ deleted: false });
    expect(rm).not.toHaveBeenCalled();
  });
});

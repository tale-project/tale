import { rm } from 'node:fs/promises';

import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// `deleteApp` (#2355) guards, in isolation. The action is `'use node'` and pulls
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
    apps: {
      upload_mutations: {
        verifyAppUploadIntent: 'verifyAppUploadIntent',
        deleteAppUploadIntent: 'deleteAppUploadIntent',
        claimAppUploadSlot: 'claimAppUploadSlot',
        releaseAppUploadSlot: 'releaseAppUploadSlot',
      },
      install_mutations: {
        getAppInstallationInternal: 'getAppInstallationInternal',
      },
    },
  },
}));

const mockRequireOrgAdminOrDeveloper = vi.fn();
vi.mock('../lib/auth/require_org_admin_or_developer', () => ({
  requireOrgAdminOrDeveloper: (...args: unknown[]) =>
    mockRequireOrgAdminOrDeveloper(...args),
}));

const mockAppExistsInBuiltinCatalog = vi.fn();
vi.mock('./install_fs', () => ({
  appExistsInBuiltinCatalog: (...args: unknown[]) =>
    mockAppExistsInBuiltinCatalog(...args),
}));

const mockReadFileSafe = vi.fn();
vi.mock('../lib/file_io', () => ({
  atomicWriteBuffer: vi.fn(),
  readFileSafe: (...args: unknown[]) => mockReadFileSafe(...args),
  verifyPathWithinBase: vi.fn(),
}));

vi.mock('./file_utils', () => ({
  resolveAppDir: (orgSlug: string, slug: string) =>
    `/cfg/${orgSlug}/apps/${slug}`,
  resolveAppManifestPath: (orgSlug: string, slug: string) =>
    `/cfg/${orgSlug}/apps/${slug}/app.json`,
  resolveAppsDir: (orgSlug: string) => `/cfg/${orgSlug}/apps`,
}));

vi.mock('./bundle_parse', () => ({ parseAppBundleZip: vi.fn() }));

const { deleteApp } = await import('./upload_actions');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<unknown>;
};
const deleteHandler = (deleteApp as unknown as ActionConfig).handler;

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

describe('apps/upload_actions deleteApp (#2355)', () => {
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

  it('refuses to delete a built-in catalog app', async () => {
    mockAppExistsInBuiltinCatalog.mockResolvedValue(true);
    const err = (await catchError(
      deleteHandler(createMockCtx(), {
        organizationId: 'org',
        slug: 'issue-desk',
      } as never),
    )) as ConvexError<{ code: string }>;
    expect(err.data.code).toBe('APP_IS_BUILTIN');
    expect(rm).not.toHaveBeenCalled();
  });

  it('refuses while an install record still exists', async () => {
    mockAppExistsInBuiltinCatalog.mockResolvedValue(false);
    const err = (await catchError(
      deleteHandler(createMockCtx({ appSlug: 'my-upload' }), {
        organizationId: 'org',
        slug: 'my-upload',
      } as never),
    )) as ConvexError<{ code: string }>;
    expect(err.data.code).toBe('APP_INSTALLED');
    expect(rm).not.toHaveBeenCalled();
  });

  it('removes the org app dir for a private, not-installed app', async () => {
    mockAppExistsInBuiltinCatalog.mockResolvedValue(false);
    mockReadFileSafe.mockResolvedValue('{"name":"X"}');
    const result = await deleteHandler(createMockCtx(null), {
      organizationId: 'org',
      slug: 'my-upload',
    } as never);
    expect(result).toEqual({ deleted: true });
    expect(rm).toHaveBeenCalledWith('/cfg/acme/apps/my-upload', {
      recursive: true,
      force: true,
    });
  });

  it('is a no-op when no bundle is on disk', async () => {
    mockAppExistsInBuiltinCatalog.mockResolvedValue(false);
    mockReadFileSafe.mockResolvedValue(null);
    const result = await deleteHandler(createMockCtx(null), {
      organizationId: 'org',
      slug: 'my-upload',
    } as never);
    expect(result).toEqual({ deleted: false });
    expect(rm).not.toHaveBeenCalled();
  });
});

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

const mockParseAutomationBundleZip = vi.fn();
vi.mock('./bundle_parse', () => ({
  parseAutomationBundleZip: (...args: unknown[]) =>
    mockParseAutomationBundleZip(...args),
}));

const mockPrepareInstallAs = vi.fn();
const mockEnsureOrgResources = vi.fn();
vi.mock('./install_actions', () => ({
  prepareInstallAs: (...args: unknown[]) => mockPrepareInstallAs(...args),
  ensureOrgResources: (...args: unknown[]) => mockEnsureOrgResources(...args),
}));

const { deleteAutomation, uploadAutomationBundle } =
  await import('./upload_actions');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<unknown>;
};
const deleteHandler = (deleteAutomation as unknown as ActionConfig).handler;
const uploadHandler = (uploadAutomationBundle as unknown as ActionConfig)
  .handler;

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
  mockRequireOrgAdminOrDeveloper.mockResolvedValue({
    orgSlug: 'acme',
    userId: 'user_1',
    email: 'dev@acme.io',
  });
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

// ---------------------------------------------------------------------------
// `uploadAutomationBundle` post-swap resync: replacing the bundle of an
// INSTALLED automation re-runs the shared install pipeline in the same call,
// so the operator never has to click Reinstall by hand. Storage, fs, parse,
// and the install core are all mocked; each test drives one outcome of the
// returned `install` field.
// ---------------------------------------------------------------------------

function createUploadCtx(installRecord: unknown = null) {
  return {
    // The handler's only runQuery is the install-record lookup.
    runQuery: vi.fn().mockResolvedValue(installRecord),
    // verifyAutomationUploadIntent must report an intent match; the claim /
    // release / delete-intent mutations return nothing.
    runMutation: vi.fn((ref: unknown) =>
      Promise.resolve(ref === 'verifyAutomationUploadIntent' ? true : null),
    ),
    storage: {
      get: vi.fn().mockResolvedValue({
        size: 16,
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  } as never;
}

const UPLOAD_ARGS = {
  organizationId: 'org',
  storageId: 'st_1',
  force: true,
} as never;

describe('automations/upload_actions uploadAutomationBundle resync-on-replace', () => {
  beforeEach(() => {
    mockAutomationExistsInBuiltinCatalog.mockResolvedValue(false);
    mockParseAutomationBundleZip.mockResolvedValue({
      slug: 'my-upload',
      files: [
        { relPath: 'automation.json', content: new Uint8Array([123, 125]) },
      ],
    });
    // A prior bundle exists on disk (the replace path under test).
    mockReadFileSafe.mockResolvedValue('{"name":"Old"}');
    mockPrepareInstallAs.mockResolvedValue({
      orgSlug: 'acme',
      installedBy: 'dev@acme.io',
      manifest: { name: 'New' },
    });
    mockEnsureOrgResources.mockResolvedValue({
      workflows: 1,
      agents: 2,
      resources: 3,
    });
  });

  it('re-runs the install pipeline when the replaced slug is installed', async () => {
    const ctx = createUploadCtx({ automationSlug: 'my-upload' });
    const result = await uploadHandler(ctx, UPLOAD_ARGS);
    expect(result).toEqual({
      ok: true,
      slug: 'my-upload',
      install: 'resynced',
    });
    expect(mockPrepareInstallAs).toHaveBeenCalledWith(
      'acme',
      'my-upload',
      'dev@acme.io',
    );
    expect(mockEnsureOrgResources).toHaveBeenCalledWith(
      ctx,
      'org',
      'my-upload',
      {
        orgSlug: 'acme',
        installedBy: 'dev@acme.io',
        manifest: { name: 'New' },
      },
    );
  });

  it('skips the resync when the slug has no install record', async () => {
    const result = await uploadHandler(createUploadCtx(null), UPLOAD_ARGS);
    expect(result).toEqual({ ok: true, slug: 'my-upload', install: 'none' });
    expect(mockPrepareInstallAs).not.toHaveBeenCalled();
    expect(mockEnsureOrgResources).not.toHaveBeenCalled();
  });

  it('skips the resync while the install is mid-uninstall', async () => {
    const result = await uploadHandler(
      createUploadCtx({ automationSlug: 'my-upload', uninstalling: true }),
      UPLOAD_ARGS,
    );
    expect(result).toEqual({ ok: true, slug: 'my-upload', install: 'none' });
    expect(mockPrepareInstallAs).not.toHaveBeenCalled();
  });

  it('reports resync_failed without failing the upload when the pipeline throws', async () => {
    mockEnsureOrgResources.mockRejectedValue(new Error('fan-out copy failed'));
    const result = await uploadHandler(
      createUploadCtx({ automationSlug: 'my-upload' }),
      UPLOAD_ARGS,
    );
    expect(result).toEqual({
      ok: true,
      slug: 'my-upload',
      install: 'resync_failed',
    });
  });

  it('keeps the needs_confirm refusal untouched (no resync attempt)', async () => {
    const ctx = createUploadCtx({ automationSlug: 'my-upload' });
    const result = await uploadHandler(ctx, {
      organizationId: 'org',
      storageId: 'st_1',
    } as never);
    expect(result).toEqual({
      ok: false,
      status: 'needs_confirm',
      slug: 'my-upload',
    });
    expect(mockPrepareInstallAs).not.toHaveBeenCalled();
  });
});

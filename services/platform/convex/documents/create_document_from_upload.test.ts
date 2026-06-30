import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('convex/values', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stub = () => 'validator';
  return {
    // Preserve the real `ConvexError` so the handler's structured throws
    // construct correctly; only the `v` validator builders are stubbed.
    ...actual,
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      id: stub,
      object: stub,
      union: stub,
      literal: stub,
      array: stub,
      null: stub,
    },
  };
});

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
  };
});

vi.mock('../_generated/api', () => ({
  internal: {
    file_metadata: {
      internal_mutations: {
        saveFileMetadata: 'saveFileMetadata',
        linkDocumentToFile: 'linkDocumentToFile',
      },
    },
  },
}));

const mockGetAuthUser = vi.fn();
vi.mock('../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

// Sources import these directly (not via the lib/rls barrel), so mock the
// concrete module. The real getAuthUserIdentity is left unmocked so the
// migrated auth path runs against the mock ctx's ctx.auth.getUserIdentity().
vi.mock('../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: vi.fn().mockResolvedValue({
    _id: 'member_1',
    organizationId: 'org_1',
    userId: 'user_1',
    role: 'member',
  }),
}));

vi.mock('../lib/get_user_teams', () => ({
  getUserTeamIds: vi.fn().mockResolvedValue(['team_1']),
}));

const mockHasTeamAccess = vi.fn().mockReturnValue(true);
vi.mock('../lib/team_access', () => ({
  hasTeamAccess: (...args: unknown[]) => mockHasTeamAccess(...args),
}));

const mockCreateDocument = vi.fn().mockResolvedValue({
  success: true,
  documentId: 'doc_created',
});
vi.mock('./create_document', () => ({
  createDocument: (...args: unknown[]) => mockCreateDocument(...args),
}));

vi.mock('./update_document', () => ({
  updateDocument: vi.fn(),
}));

vi.mock('../governance/upload_enforcement', () => ({
  checkUploadPolicy: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('./validators', () => ({
  sourceProviderValidator: 'validator',
}));

vi.mock('../../lib/shared/schemas/utils/json-value', () => ({
  jsonValueValidator: 'validator',
  jsonRecordValidator: 'validator',
}));

async function getHandler() {
  const { createDocumentFromUpload } = await import('./mutations');
  return (createDocumentFromUpload as unknown as { handler: Function }).handler;
}

function createMockCtx() {
  return {
    db: {
      get: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockResolvedValue('fm_new'),
      patch: vi.fn().mockResolvedValue(undefined),
    },
    auth: {
      // Production now reads JWT identity via getAuthUserIdentity, which
      // calls ctx.auth.getUserIdentity(). Derive it from the same
      // mockGetAuthUser source, mapping _id -> subject.
      getUserIdentity: vi.fn(async () => {
        const u = await mockGetAuthUser();
        return u ? { subject: u._id, email: u.email, name: u.name } : null;
      }),
    },
    runMutation: vi.fn().mockResolvedValue('fm_new'),
    scheduler: {
      runAfter: vi.fn().mockResolvedValue(undefined),
    },
  };
}

const AUTH_USER = {
  _id: 'user_1',
  email: 'test@example.com',
  name: 'Test User',
};

const baseArgs = {
  organizationId: 'org_1',
  fileId: 'storage_1',
  fileName: 'report.pdf',
  contentType: 'application/pdf',
  fileSize: 2048,
};

describe('createDocumentFromUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateDocument.mockResolvedValue({
      success: true,
      documentId: 'doc_created',
    });
    mockHasTeamAccess.mockReturnValue(true);
  });

  it('rejects unauthenticated requests', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, baseArgs)).rejects.toMatchObject({
      data: { code: 'UNAUTHENTICATED' },
    });
  });

  it('saves file metadata via runMutation when fileSize is provided', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    expect(ctx.runMutation).toHaveBeenCalledWith('saveFileMetadata', {
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      size: 2048,
      uploadedBy: 'user_1',
    });
  });

  it('skips file metadata save when fileSize is not provided', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();
    const { fileSize: _, ...argsWithoutSize } = baseArgs;

    await handler(ctx, argsWithoutSize);

    expect(ctx.runMutation).not.toHaveBeenCalledWith(
      'saveFileMetadata',
      expect.anything(),
    );
  });

  it('creates document and returns documentId', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();

    const result = await handler(ctx, baseArgs);

    expect(result).toEqual({
      success: true,
      documentId: 'doc_created',
    });
    expect(mockCreateDocument).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        organizationId: 'org_1',
        title: 'report.pdf',
        fileId: 'storage_1',
        sourceProvider: 'upload',
      }),
    );
  });

  it('validates folder exists and belongs to org', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    ctx.db.get.mockResolvedValueOnce(null);
    const handler = await getHandler();

    await expect(
      handler(ctx, { ...baseArgs, folderId: 'folder_1' }),
    ).rejects.toMatchObject({ data: { code: 'FOLDER_NOT_FOUND' } });
  });

  it('validates folder org matches', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    ctx.db.get.mockResolvedValueOnce({
      _id: 'folder_1',
      organizationId: 'org_other',
    });
    const handler = await getHandler();

    await expect(
      handler(ctx, { ...baseArgs, folderId: 'folder_1' }),
    ).rejects.toMatchObject({ data: { code: 'FOLDER_NOT_FOUND' } });
  });

  it('rejects when user lacks team access to folder', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    ctx.db.get.mockResolvedValueOnce({
      _id: 'folder_1',
      organizationId: 'org_1',
      teamId: 'team_restricted',
    });
    mockHasTeamAccess.mockReturnValueOnce(false);
    const handler = await getHandler();

    await expect(
      handler(ctx, { ...baseArgs, folderId: 'folder_1' }),
    ).rejects.toMatchObject({ data: { code: 'FOLDER_NOT_ACCESSIBLE' } });
  });

  it('links document to file after document creation', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    expect(ctx.runMutation).toHaveBeenCalledWith('linkDocumentToFile', {
      storageId: 'storage_1',
      documentId: 'doc_created',
    });
  });

  it('does not link document to file when fileSize is not provided', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();
    const { fileSize: _, ...argsWithoutSize } = baseArgs;

    await handler(ctx, argsWithoutSize);

    expect(ctx.runMutation).not.toHaveBeenCalledWith(
      'linkDocumentToFile',
      expect.anything(),
    );
  });

  it('does not schedule extractDocumentDates (handled by saveFileMetadata)', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('inherits teamId from folder', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    ctx.db.get.mockResolvedValueOnce({
      _id: 'folder_1',
      organizationId: 'org_1',
      teamId: 'team_from_folder',
    });
    const handler = await getHandler();

    await handler(ctx, { ...baseArgs, folderId: 'folder_1' });

    expect(mockCreateDocument).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        teamId: 'team_from_folder',
      }),
    );
  });
});

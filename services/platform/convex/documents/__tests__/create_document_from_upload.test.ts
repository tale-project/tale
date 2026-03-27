import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
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

vi.mock('../../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
  };
});

vi.mock('../../_generated/api', () => ({
  internal: {
    documents: {
      internal_actions: {
        extractDocumentDates: 'extractDocumentDates',
      },
    },
  },
}));

const mockGetAuthUser = vi.fn();
vi.mock('../../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

vi.mock('../../lib/rls', () => ({
  getOrganizationMember: vi.fn().mockResolvedValue({
    _id: 'member_1',
    organizationId: 'org_1',
    userId: 'user_1',
    role: 'member',
  }),
}));

vi.mock('../../lib/get_user_teams', () => ({
  getUserTeamIds: vi.fn().mockResolvedValue(['team_1']),
}));

const mockHasTeamAccess = vi.fn().mockReturnValue(true);
vi.mock('../../lib/team_access', () => ({
  hasTeamAccess: (...args: unknown[]) => mockHasTeamAccess(...args),
}));

const mockCreateDocument = vi.fn().mockResolvedValue({
  success: true,
  documentId: 'doc_created',
});
vi.mock('../create_document', () => ({
  createDocument: (...args: unknown[]) => mockCreateDocument(...args),
}));

vi.mock('../update_document', () => ({
  updateDocument: vi.fn(),
}));

vi.mock('../validators', () => ({
  sourceProviderValidator: 'validator',
}));

vi.mock('../../../lib/shared/schemas/utils/json-value', () => ({
  jsonValueValidator: 'validator',
  jsonRecordValidator: 'validator',
}));

async function getHandler() {
  const { createDocumentFromUpload } = await import('../mutations');
  return (createDocumentFromUpload as unknown as { handler: Function }).handler;
}

function createMockCtx() {
  return {
    db: {
      get: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockResolvedValue('fm_new'),
      patch: vi.fn().mockResolvedValue(undefined),
    },
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

    await expect(handler(ctx, baseArgs)).rejects.toThrow('Unauthenticated');
  });

  it('inserts file metadata when fileSize is provided', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    expect(ctx.db.insert).toHaveBeenCalledWith('fileMetadata', {
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      size: 2048,
    });
  });

  it('skips file metadata insert when fileSize is not provided', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();
    const { fileSize: _, ...argsWithoutSize } = baseArgs;

    await handler(ctx, argsWithoutSize);

    expect(ctx.db.insert).not.toHaveBeenCalled();
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
    ).rejects.toThrow('Folder not found');
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
    ).rejects.toThrow('Folder not found');
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
    ).rejects.toThrow('Folder not accessible');
  });

  it('patches fileMetadata with documentId after document creation', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_new', {
      documentId: 'doc_created',
    });
  });

  it('does not patch fileMetadata when fileSize is not provided', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();
    const { fileSize: _, ...argsWithoutSize } = baseArgs;

    await handler(ctx, argsWithoutSize);

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('schedules extractDocumentDates for PDF uploads', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      'extractDocumentDates',
      {
        documentId: 'doc_created',
        fileId: 'storage_1',
      },
    );
  });

  it('does not schedule extractDocumentDates for TXT uploads', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await handler(ctx, {
      ...baseArgs,
      fileName: 'notes.txt',
      contentType: 'text/plain',
    });

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

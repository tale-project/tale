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

vi.mock('../../lib/rate_limiter/helpers', () => ({
  checkOrganizationRateLimit: vi.fn(),
  RateLimitExceededError: class extends Error {},
}));

vi.mock('../../_generated/api', () => ({
  internal: {
    governance: { retention_cleanup: { runRetentionCleanup: 'mock' } },
    file_metadata: { internal_actions: { uploadFileToRag: 'mock' } },
  },
}));

const mockGetAuthUser = vi.fn();
vi.mock('../../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

vi.mock('../../governance/upload_enforcement', () => ({
  checkUploadPolicy: vi.fn().mockResolvedValue({ allowed: true }),
}));

function createMockCtx(existingDoc: Record<string, unknown> | null = null) {
  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(existingDoc),
  };

  const ctx = {
    db: {
      query: vi.fn().mockReturnValue(builder),
      insert: vi.fn().mockResolvedValue('fm_new'),
      patch: vi.fn().mockResolvedValue(undefined),
    },
    scheduler: {
      runAfter: vi.fn().mockResolvedValue(undefined),
    },
  };

  return { ctx, builder };
}

async function getHandler() {
  const { saveFileMetadata } = await import('../mutations');
  return (saveFileMetadata as unknown as { handler: Function }).handler;
}

const baseArgs = {
  organizationId: 'org_1',
  storageId: 'storage_1',
  fileName: 'test.pdf',
  contentType: 'application/pdf',
  size: 1024,
};

const AUTH_USER = {
  _id: 'user_1',
  email: 'test@example.com',
  name: 'Test User',
};

describe('saveFileMetadata (public)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const { ctx } = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, baseArgs)).rejects.toThrow('Unauthenticated');
  });

  it('inserts new file metadata when none exists', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx(null);
    const handler = await getHandler();

    const result = await handler(ctx, baseArgs);

    expect(result).toBe('fm_new');
    expect(ctx.db.insert).toHaveBeenCalledWith('fileMetadata', {
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      ragStatus: 'queued',
      ragQueuedAt: expect.any(Number),
      uploadedBy: 'user_1',
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('patches existing file metadata by storageId', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      size: 512,
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getHandler();

    const result = await handler(ctx, {
      ...baseArgs,
      fileName: 'new.pdf',
      size: 2048,
    });

    expect(result).toBe('fm_existing');
    // Existing row had no ragStatus, so the retry-on-reuse logic kicks in:
    // reset status + stamp queuedAt + reschedule uploadFileToRag.
    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'new.pdf',
      contentType: 'application/pdf',
      size: 2048,
      uploadedBy: 'user_1',
      ragStatus: 'queued',
      ragError: undefined,
      ragProgress: undefined,
      ragQueuedAt: expect.any(Number),
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('does not reschedule RAG when existing row already completed', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      size: 512,
      ragStatus: 'completed',
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      uploadedBy: 'user_1',
    });
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalledWith(
      0,
      'mock',
      expect.objectContaining({ storageId: 'storage_1' }),
    );
  });

  it('reschedules RAG when existing row previously failed', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      size: 512,
      ragStatus: 'failed',
      ragError: 'old error',
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      uploadedBy: 'user_1',
      ragStatus: 'queued',
      ragError: undefined,
      ragProgress: undefined,
      ragQueuedAt: expect.any(Number),
    });
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      'mock',
      expect.objectContaining({ storageId: 'storage_1' }),
    );
  });

  it('queries by storageId index', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx, builder } = createMockCtx(null);
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    expect(ctx.db.query).toHaveBeenCalledWith('fileMetadata');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_storageId',
      expect.any(Function),
    );
  });

  it('includes documentId on insert when provided', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx(null);
    const handler = await getHandler();

    await handler(ctx, { ...baseArgs, documentId: 'doc_1' });

    expect(ctx.db.insert).toHaveBeenCalledWith('fileMetadata', {
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      uploadedBy: 'user_1',
      documentId: 'doc_1',
      ragStatus: 'queued',
      ragQueuedAt: expect.any(Number),
    });
  });

  it('does not clear existing documentId when not provided', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      documentId: 'doc_existing',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      size: 512,
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    // Existing row has no ragStatus, so retry-on-reuse kicks in (same
    // as "patches existing" case); documentId must not be cleared.
    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      uploadedBy: 'user_1',
      ragStatus: 'queued',
      ragError: undefined,
      ragProgress: undefined,
      ragQueuedAt: expect.any(Number),
    });
  });
});
